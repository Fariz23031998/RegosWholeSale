import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, Search } from "lucide-react";
import clsx from "clsx";
import { useLanguage } from "@/contexts/LanguageContext";
import { useWarehouseScope } from "@/hooks/use-warehouse-scope";
import { Modal } from "@/components/posui/Modal";
import { DashboardPeriodModal } from "@/components/Dashboard/DashboardPeriodModal";
import { formatAuthError, useAuth } from "@/store/auth";
import { useCart, type CartItem, type DiscountMode } from "@/store/cart";
import { useCatalog } from "@/store/catalog";
import { usePosConfig } from "@/store/pos-config";
import { useSellContext } from "@/store/sell-context";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { PRODUCT_FALLBACK_IMAGE } from "@/lib/product-image";
import type { RegosCurrencyOption } from "@/types/settings";
import {
  getPeriodLabel,
  presetToCustomRange,
  resolveDashboardPeriodParams,
  type DashboardCustomRange,
  type DashboardPeriodPreset,
} from "@/lib/dashboard-api";
import {
  fetchWholesaleDocuments,
  fetchWholesaleOperations,
  type PostponedDocumentKind,
  type WholesaleDocument,
  type WholesaleOperationLine,
} from "@/lib/sales-api";
import {
  listOperationPrice,
  operativeOperationPrice,
} from "@/lib/currency-conversion";
import type { Product } from "@/types/catalog";
import dashboardStyles from "@/components/Dashboard/Dashboard.module.css";
import styles from "@/components/Returns/Returns.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
};

type SalePeriodPreset = Exclude<DashboardPeriodPreset, "custom">;

const SALE_PERIOD_PRESETS: SalePeriodPreset[] = ["today", "week", "month", "all"];

function operationsToCartItems(
  operations: WholesaleOperationLine[],
  catalogProducts: Product[],
  currency: RegosCurrencyOption | null | undefined,
  t: (key: string, fallback?: string, params?: Record<string, string | number>) => string,
): CartItem[] {
  return operations.map((op) => {
    const productId = String(op.item_id);
    const catalogProduct = catalogProducts.find(
      (product) =>
        product.regos_item_id === op.item_id || product.id === productId,
    );
    return {
      productId,
      regosItemId: op.item_id,
      name:
        op.item_name ??
        catalogProduct?.name ??
        t("sales.itemFallback", "Item #{{id}}", { id: op.item_id }),
      price: operativeOperationPrice(op.price, op.price2, currency),
      qty: op.quantity,
      postponedQty: op.quantity,
      image: catalogProduct?.image ?? PRODUCT_FALLBACK_IMAGE,
      unitType: catalogProduct?.unit_type ?? null,
      itemCode: op.item_code ?? catalogProduct?.code ?? null,
      itemArticul: op.item?.articul ?? catalogProduct?.articul ?? null,
      itemGroupId: op.item_group_id ?? catalogProduct?.group_id ?? null,
      itemGroupName: op.item_group_name ?? catalogProduct?.category ?? null,
      itemUnitName: op.item_unit_name ?? catalogProduct?.unit_name ?? null,
      itemBrand: op.item_brand ?? null,
    };
  });
}

function discountFromOperations(
  operations: WholesaleOperationLine[],
  currency: RegosCurrencyOption | null | undefined,
): {
  discountMode: DiscountMode;
  discountValue: number;
} {
  const subtotal = operations.reduce(
    (sum, op) =>
      sum + listOperationPrice(op.price, op.price2, currency) * op.quantity,
    0,
  );
  const total = operations.reduce(
    (sum, op) =>
      sum + operativeOperationPrice(op.price, op.price2, currency) * op.quantity,
    0,
  );
  const discount = Math.max(0, +(subtotal - total).toFixed(2));
  if (discount <= 0) {
    return { discountMode: "percent", discountValue: 0 };
  }
  return { discountMode: "amount", discountValue: discount };
}

function resolvePriceTypeIdFromDocument(doc: WholesaleDocument): number | null {
  if (typeof doc.price_type_id === "number" && doc.price_type_id > 0) {
    return doc.price_type_id;
  }
  const currencyId = doc.currency?.id;
  if (typeof currencyId !== "number" || currencyId <= 0) {
    return null;
  }
  const matched = useSellContext
    .getState()
    .options.price_types.find((priceType) => priceType.currency?.id === currencyId);
  return matched?.id ?? null;
}

function applySellContextFromDocument(doc: WholesaleDocument): void {
  const sellContext = useSellContext.getState();
  if (typeof doc.partner_id === "number" && doc.partner_id > 0) {
    sellContext.setPartnerId(doc.partner_id);
  }
  if (typeof doc.stock_id === "number" && doc.stock_id > 0) {
    sellContext.setWarehouseId(doc.stock_id);
  }
  const priceTypeId = resolvePriceTypeIdFromDocument(doc);
  if (priceTypeId != null) {
    sellContext.setPriceTypeId(priceTypeId);
  }
}

export function ContinueSaleModal({ open, onClose }: Props) {
  const { t } = useLanguage();
  const accessToken = useAuth((s) => s.accessToken);
  const { ready: warehouseScopeReady, scopedStockQueryParams } = useWarehouseScope();
  const restore = useCart((s) => s.restore);
  const setPostponedWholesaleDocId = useCart((s) => s.setPostponedWholesaleDocId);
  const setPostponedDocType = useCart((s) => s.setPostponedDocType);
  const postponeDocumentType = usePosConfig((s) => s.postponeDocumentType);
  const catalogProducts = useCatalog((s) => s.products);

  const documentKind: PostponedDocumentKind =
    postponeDocumentType === "doc_order_from_partner"
      ? "order_from_partner"
      : "wholesale";

  const [search, setSearch] = useState("");
  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>("month");
  const [customRange, setCustomRange] = useState<DashboardCustomRange | null>(null);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [documents, setDocuments] = useState<WholesaleDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectingId, setSelectingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const periodModalRange = useMemo(() => {
    if (periodPreset === "custom" && customRange) return customRange;
    if (periodPreset !== "custom") return presetToCustomRange(periodPreset);
    return presetToCustomRange("month");
  }, [customRange, periodPreset]);

  const reset = useCallback(() => {
    setSearch("");
    setPeriodPreset("month");
    setCustomRange(null);
    setPeriodModalOpen(false);
    setDocuments([]);
    setLoading(false);
    setSelectingId(null);
    setError("");
  }, []);

  const handleClose = () => {
    if (selectingId !== null) return;
    reset();
    onClose();
  };

  useEffect(() => {
    if (!open || !accessToken || !warehouseScopeReady) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    const periodParams = resolveDashboardPeriodParams(periodPreset, customRange);
    void fetchWholesaleDocuments(accessToken, {
      ...periodParams,
      performed: documentKind === "wholesale" ? false : undefined,
      document_kind: documentKind,
      continuable_only: documentKind === "order_from_partner",
      limit: 100,
      ...scopedStockQueryParams({ allStocks: true, stockIds: [] }),
    })
      .then((response) => {
        if (!cancelled) setDocuments(response.documents);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(formatAuthError(err, t("cart.continueModal.errors.load", "Failed to load postponed sales")));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    open,
    accessToken,
    documentKind,
    periodPreset,
    customRange,
    scopedStockQueryParams,
    t,
    warehouseScopeReady,
  ]);

  const filteredDocuments = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return documents;
    return documents.filter((doc) => {
      const haystack = [doc.code, doc.partner_name ?? "", doc.stock_name ?? ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [documents, search]);

  const selectDocument = async (doc: WholesaleDocument) => {
    if (!accessToken) return;

    setSelectingId(doc.id);
    setError("");

    try {
      const { operations } = await fetchWholesaleOperations(
        accessToken,
        doc.id,
        documentKind,
      );
      if (operations.length === 0) {
        setError(t("cart.continueModal.noItems", "This postponed sale has no line items."));
        return;
      }

      const { discountMode, discountValue } = discountFromOperations(
        operations,
        doc.currency,
      );
      restore({
        items: operationsToCartItems(operations, catalogProducts, doc.currency, t),
        discountMode,
        discountValue,
        postponedWholesaleDocId: doc.id,
        postponedDocType: documentKind,
      });
      setPostponedWholesaleDocId(doc.id);
      setPostponedDocType(documentKind);
      applySellContextFromDocument(doc);
      reset();
      onClose();
    } catch (err: unknown) {
      setError(formatAuthError(err, t("cart.continueModal.errors.select", "Failed to load postponed sale")));
    } finally {
      setSelectingId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t("cart.continueModal.title", "Continue Sale")}
      size="xl"
      modalClassName={styles.continueSaleModal}
      bodyClassName={styles.continueSaleBody}
    >
      <div className={dashboardStyles.filters}>
        {SALE_PERIOD_PRESETS.map((value) => (
          <button
            key={value}
            type="button"
            className={clsx(
              dashboardStyles.filter,
              periodPreset === value && dashboardStyles.filterActive,
            )}
            onClick={() => {
              setPeriodPreset(value);
              setCustomRange(null);
            }}
          >
            {getPeriodLabel(value, t)}
          </button>
        ))}
        <button
          type="button"
          className={clsx(
            dashboardStyles.filter,
            dashboardStyles.filterMenu,
            periodPreset === "custom" && dashboardStyles.filterActive,
          )}
          onClick={() => setPeriodModalOpen(true)}
        >
          <CalendarRange size={14} />
          {t("dashboard.period")}
        </button>
      </div>

      <div className={styles.searchBox}>
        <Search size={16} />
        <input
          className={styles.searchInput}
          placeholder={t(
            "cart.continueModal.searchPlaceholder",
            "Search by code, customer, or warehouse…",
          )}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.status}>{t("cart.continueModal.loading", "Loading postponed sales…")}</div>
      ) : filteredDocuments.length === 0 ? (
        <div className={styles.status}>
          {documentKind === "order_from_partner"
            ? t("cart.continueModal.emptyOrders", "No postponed orders found.")
            : t("cart.continueModal.empty", "No unperformed wholesale sales found.")}
        </div>
      ) : (
        <div className={clsx(styles.saleList, styles.continueSaleList)}>
          {filteredDocuments.map((doc) => (
            <button
              key={doc.id}
              type="button"
              className={styles.saleRow}
              disabled={selectingId !== null}
              onClick={() => void selectDocument(doc)}
            >
              <div>
                <div className={styles.saleCode}>{doc.code}</div>
                <div className={styles.saleMeta}>
                  {formatDateTime(new Date(doc.date * 1000).toISOString())}
                  {doc.partner_name ? ` · ${doc.partner_name}` : ""}
                  {doc.stock_name ? ` · ${doc.stock_name}` : ""}
                </div>
              </div>
              <div className={styles.saleAmount}>
                {selectingId === doc.id
                  ? t("common.loading", "Loading...")
                  : formatCurrency(doc.amount ?? 0)}
              </div>
            </button>
          ))}
        </div>
      )}

      <DashboardPeriodModal
        open={periodModalOpen}
        onClose={() => setPeriodModalOpen(false)}
        initialRange={periodModalRange}
        onApply={(range) => {
          setCustomRange(range);
          setPeriodPreset("custom");
          setPeriodModalOpen(false);
        }}
      />
    </Modal>
  );
}
