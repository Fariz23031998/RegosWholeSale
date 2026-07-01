import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useWarehouseScope } from "@/hooks/use-warehouse-scope";
import { Modal } from "@/components/posui/Modal";
import { formatAuthError, useAuth } from "@/store/auth";
import { useCart, type CartItem, type DiscountMode } from "@/store/cart";
import { useCatalog } from "@/store/catalog";
import { usePosConfig } from "@/store/pos-config";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { PRODUCT_FALLBACK_IMAGE } from "@/lib/product-image";
import type { RegosCurrencyOption } from "@/types/settings";
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
import styles from "@/components/Returns/Returns.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
};

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
  const [documents, setDocuments] = useState<WholesaleDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectingId, setSelectingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const reset = useCallback(() => {
    setSearch("");
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

    void fetchWholesaleDocuments(accessToken, {
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
  }, [open, accessToken, documentKind, scopedStockQueryParams, warehouseScopeReady]);

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
      reset();
      onClose();
    } catch (err: unknown) {
      setError(formatAuthError(err, t("cart.continueModal.errors.select", "Failed to load postponed sale")));
    } finally {
      setSelectingId(null);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title={t("cart.continueModal.title", "Continue Sale")}>
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
        <div className={styles.saleList}>
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
    </Modal>
  );
}
