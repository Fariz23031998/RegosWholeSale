import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, Search, Undo2 } from "lucide-react";
import clsx from "clsx";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { QtyKeypad } from "@/components/Cart/QtyKeypad";
import {
  PaymentPanel,
  type PaymentSubmitPayload,
} from "@/components/Checkout/PaymentPanel";
import { DashboardPeriodModal } from "@/components/Dashboard/DashboardPeriodModal";
import { PartnerPickerModal } from "@/components/POS/PartnerPickerModal";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  getPeriodLabel,
  presetToCustomRange,
  resolveDashboardPeriodParams,
  type DashboardCustomRange,
  type DashboardPeriodPreset,
} from "@/lib/dashboard-api";
import { usePermissions } from "@/hooks/use-permissions";
import { filterCheckoutOverrides } from "@/types/users";
import { formatAuthError, useAuth } from "@/store/auth";
import { usePosConfig } from "@/store/pos-config";
import { useSellContext } from "@/store/sell-context";
import { fetchCatalogProducts } from "@/lib/catalog-api";
import {
  findProductByBarcode,
  findProductByCode,
  internalBarcodeToQty,
  isBarcodeInput,
  parseInternalBarcode,
} from "@/lib/barcode";
import { formatAmountWithCurrency } from "@/lib/checkout-payments";
import { operativeOperationPrice } from "@/lib/currency-conversion";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  fetchWholesaleDocuments,
  fetchWholesaleOperations,
  fetchWholesaleReturnSummary,
  submitWholesaleReturn,
  type WholesaleDocument,
  type WholesaleOperationLine,
} from "@/lib/sales-api";
import type { Product } from "@/types/catalog";
import dashboardStyles from "@/components/Dashboard/Dashboard.module.css";
import styles from "./Returns.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
};

type SourceMode = "sale" | "manual";
type Step = "items" | "payment" | "done";

type ReturnLine = {
  regosItemId: number;
  name: string;
  price: number;
  qty: number;
  maxQty?: number;
  soldQty?: number;
  returnedQty?: number;
};

type SalePeriodPreset = Exclude<DashboardPeriodPreset, "custom">;

const SALE_PERIOD_PRESETS: SalePeriodPreset[] = ["today", "week", "month", "all"];

export function ReturnModal({ open, onClose }: Props) {
  const { t } = useLanguage();
  const accessToken = useAuth((s) => s.accessToken);
  const { canChangePartner } = usePermissions();
  const canChangePartnerPerm = canChangePartner();
  const posSaleCurrency = useSellContext((s) => s.saleCurrency);
  const partnerId = useSellContext((s) => s.partnerId);
  const checkoutOverrides = useSellContext((s) => s.checkoutOverrides);
  const refreshPartnerOptions = useSellContext((s) => s.refreshPartnerOptions);
  const catalogQuery = useSellContext((s) => s.catalogQuery);
  const internalBarcodeWeightPrefix = usePosConfig((s) => s.internalBarcodeWeightPrefix);
  const internalBarcodePiecePrefix = usePosConfig((s) => s.internalBarcodePiecePrefix);
  const hydratePosConfig = usePosConfig((s) => s.hydrate);

  const [sourceMode, setSourceMode] = useState<SourceMode>("sale");
  const [step, setStep] = useState<Step>("items");
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [reason, setReason] = useState("");
  const [keypadFor, setKeypadFor] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  const [saleSearch, setSaleSearch] = useState("");
  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>("month");
  const [customRange, setCustomRange] = useState<DashboardCustomRange | null>(null);
  const [periodModalOpen, setPeriodModalOpen] = useState(false);
  const [documents, setDocuments] = useState<WholesaleDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [selectedSale, setSelectedSale] = useState<WholesaleDocument | null>(null);

  const periodModalRange = useMemo(() => {
    if (periodPreset === "custom" && customRange) return customRange;
    if (periodPreset !== "custom") return presetToCustomRange(periodPreset);
    return presetToCustomRange("month");
  }, [customRange, periodPreset]);

  const [productSearch, setProductSearch] = useState("");
  const [debouncedProductSearch, setDebouncedProductSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const isBarcodeMode = isBarcodeInput(productSearch.trim());

  const [partnerPickerOpen, setPartnerPickerOpen] = useState(false);
  const [returnPartnerId, setReturnPartnerId] = useState<number | null>(null);
  const [returnPartnerName, setReturnPartnerName] = useState<string | null>(null);

  const [successCode, setSuccessCode] = useState<string | null>(null);

  const reset = useCallback(() => {
    setSourceMode("sale");
    setStep("items");
    setLines([]);
    setReason("");
    setKeypadFor(null);
    setProcessing(false);
    setError("");
    setSaleSearch("");
    setPeriodPreset("month");
    setCustomRange(null);
    setPeriodModalOpen(false);
    setDocuments([]);
    setSelectedSale(null);
    setProductSearch("");
    setDebouncedProductSearch("");
    setSearchResults([]);
    setReturnPartnerId(null);
    setReturnPartnerName(null);
    setSuccessCode(null);
  }, []);

  const handleClose = () => {
    if (processing) return;
    reset();
    onClose();
  };

  useEffect(() => {
    if (!open || !accessToken || sourceMode !== "sale") return;

    let cancelled = false;
    setDocumentsLoading(true);
    const params = resolveDashboardPeriodParams(periodPreset, customRange);
    void fetchWholesaleDocuments(accessToken, { ...params, performed: true, limit: 100 })
      .then((res) => {
        if (!cancelled) setDocuments(res.documents);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(formatAuthError(err, t("returns.errors.loadSales")));
      })
      .finally(() => {
        if (!cancelled) setDocumentsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, accessToken, sourceMode, periodPreset, customRange, t]);

  useEffect(() => {
    if (!open || !accessToken) return;
    void hydratePosConfig(accessToken);
  }, [accessToken, hydratePosConfig, open]);

  useEffect(() => {
    if (isBarcodeMode) return;
    const timer = window.setTimeout(
      () => setDebouncedProductSearch(productSearch.trim()),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [isBarcodeMode, productSearch]);

  useEffect(() => {
    if (!open || !accessToken || sourceMode !== "manual") return;
    if (isBarcodeMode) {
      setSearchResults([]);
      return;
    }

    const q = debouncedProductSearch;
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    const query = catalogQuery();
    void fetchCatalogProducts(accessToken, {
      search: q,
      limit: 20,
      warehouseId: query.warehouseId,
      priceTypeId: query.priceTypeId,
    })
      .then((res) => {
        if (!cancelled) setSearchResults(res.products);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(formatAuthError(err, t("returns.errors.productSearch")));
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    accessToken,
    catalogQuery,
    debouncedProductSearch,
    isBarcodeMode,
    open,
    sourceMode,
    t,
  ]);

  const filteredDocuments = useMemo(() => {
    const q = saleSearch.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter(
      (doc) =>
        doc.code.toLowerCase().includes(q) ||
        (doc.partner_name?.toLowerCase().includes(q) ?? false),
    );
  }, [documents, saleSearch]);

  const selectSale = async (doc: WholesaleDocument) => {
    if (!accessToken) return;
    setSelectedSale(doc);
    setReturnPartnerId(doc.partner_id);
    setReturnPartnerName(doc.partner_name);
    setError("");
    setLines([]);

    try {
      const [opsRes, summaryRes] = await Promise.all([
        fetchWholesaleOperations(accessToken, doc.id),
        fetchWholesaleReturnSummary(accessToken, doc.id),
      ]);
      const returnedByItem = new Map(
        summaryRes.items.map((item) => [item.item_id, item.returned_qty]),
      );
      setLines(
        opsRes.operations
          .filter((op) => op.item_id > 0)
          .map((op) => mapOperationToLine(op, returnedByItem.get(op.item_id) ?? 0, doc.currency)),
      );
    } catch (err: unknown) {
      setError(formatAuthError(err, t("returns.errors.loadDetails")));
      setSelectedSale(null);
    }
  };

  const mapOperationToLine = (
    op: WholesaleOperationLine,
    returnedQty: number,
    saleCurrency?: WholesaleDocument["currency"],
  ): ReturnLine => {
    const soldQty = op.quantity;
    const remaining = Math.max(0, soldQty - returnedQty);
    return {
      regosItemId: op.item_id,
      name: op.item_name ?? t("sales.itemFallback", undefined, { id: op.item_id }),
      price: operativeOperationPrice(op.price, op.price2, saleCurrency),
      qty: 0,
      maxQty: remaining,
      soldQty,
      returnedQty,
    };
  };

  const setLineQty = (regosItemId: number, qty: number) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.regosItemId !== regosItemId) return line;
        const max = line.maxQty ?? Number.POSITIVE_INFINITY;
        return { ...line, qty: Math.max(0, Math.min(max, qty)) };
      }),
    );
  };

  const addManualProductWithQty = (product: Product, qty: number) => {
    const regosItemId = product.regos_item_id ?? Number(product.id);
    if (!regosItemId || regosItemId <= 0 || qty <= 0) return;

    setLines((prev) => {
      const existing = prev.find((line) => line.regosItemId === regosItemId);
      if (existing) {
        return prev.map((line) =>
          line.regosItemId === regosItemId ? { ...line, qty: line.qty + qty } : line,
        );
      }
      return [
        ...prev,
        {
          regosItemId,
          name: product.name,
          price: product.price,
          qty,
        },
      ];
    });
    setProductSearch("");
    setDebouncedProductSearch("");
    setSearchResults([]);
    setError("");
  };

  const addManualProduct = (product: Product) => {
    addManualProductWithQty(product, 1);
  };

  const submitManualBarcodeScan = async (term: string) => {
    if (!accessToken || !term) return;

    const prefixes = {
      weightPrefix: internalBarcodeWeightPrefix,
      piecePrefix: internalBarcodePiecePrefix,
    };
    const parsedInternal = parseInternalBarcode(term, prefixes);
    const query = catalogQuery();

    try {
      if (parsedInternal) {
        const res = await fetchCatalogProducts(accessToken, {
          search: parsedInternal.productCode,
          limit: 20,
          warehouseId: query.warehouseId,
          priceTypeId: query.priceTypeId,
        });
        const product = findProductByCode(res.products, parsedInternal.productCode);
        if (!product) {
          setError(
            t("pos.barcode.productNotFound", "No product found for this barcode."),
          );
          return;
        }

        const barcodeQty = internalBarcodeToQty(parsedInternal, product);
        if (barcodeQty == null || barcodeQty <= 0) {
          setError(
            t(
              "pos.barcode.invalidQty",
              "This barcode quantity is not valid for the product unit.",
            ),
          );
          return;
        }

        addManualProductWithQty(product, barcodeQty);
        return;
      }

      const res = await fetchCatalogProducts(accessToken, {
        search: term,
        limit: 20,
        warehouseId: query.warehouseId,
        priceTypeId: query.priceTypeId,
      });
      const product = findProductByBarcode(res.products, term);
      if (!product) {
        setError(
          t("pos.barcode.productNotFound", "No product found for this barcode."),
        );
        return;
      }

      addManualProduct(product);
    } catch (err: unknown) {
      setError(formatAuthError(err, t("returns.errors.productSearch")));
    }
  };

  const submitManualProductSearch = (term: string) => {
    if (isBarcodeInput(term)) {
      void submitManualBarcodeScan(term);
    }
  };

  const removeManualLine = (regosItemId: number) => {
    setLines((prev) => prev.filter((line) => line.regosItemId !== regosItemId));
  };

  const selectedLines = lines.filter((line) => line.qty > 0);
  const total = +selectedLines.reduce((sum, line) => sum + line.price * line.qty, 0).toFixed(2);

  const effectivePartnerId =
    sourceMode === "sale" ? (selectedSale?.partner_id ?? returnPartnerId) : partnerId;

  const returnCurrency = useMemo(
    () =>
      sourceMode === "sale" && selectedSale?.currency
        ? selectedSale.currency
        : posSaleCurrency,
    [posSaleCurrency, selectedSale?.currency, sourceMode],
  );

  const submitReturn = async (payment: PaymentSubmitPayload) => {
    if (!accessToken || selectedLines.length === 0) return;

    setProcessing(true);
    setError("");

    const items =
      sourceMode === "manual"
        ? selectedLines.map((line) => ({
            regos_item_id: line.regosItemId,
            qty: line.qty,
            price: line.price,
          }))
        : selectedLines.map((line) => ({
            regos_item_id: line.regosItemId,
            qty: line.qty,
          }));

    try {
      const partnerOverrides = canChangePartnerPerm
        ? filterCheckoutOverrides(checkoutOverrides(), {
            canChangeWarehouse: false,
            canChangePriceType: false,
            canChangePartner: true,
          })
        : {};
      const overridePartnerId = partnerOverrides.partner_id;
      const resolvedPartnerId =
        (canChangePartnerPerm && returnPartnerId) ||
        (sourceMode === "sale" ? effectivePartnerId : undefined) ||
        overridePartnerId;

      const result = await submitWholesaleReturn(accessToken, {
        ...(sourceMode === "sale" && selectedSale
          ? { wholesale_doc_id: selectedSale.id }
          : {}),
        items,
        total,
        reason: reason.trim() || undefined,
        ...(payment.payments
          ? { payments: payment.payments }
          : {
              payment_type_id: payment.payment_type_id,
              amount_paid: payment.amount_paid,
              tendered: payment.tendered,
              change: payment.change,
            }),
        ...(canChangePartnerPerm
          ? filterCheckoutOverrides(checkoutOverrides(), {
              canChangeWarehouse: false,
              canChangePriceType: false,
              canChangePartner: true,
            })
          : {}),
        ...(resolvedPartnerId ? { partner_id: resolvedPartnerId } : {}),
      });

      setSuccessCode(result.wholesale_return_code);
      setStep("done");
    } catch (err: unknown) {
      setError(formatAuthError(err, t("returns.errors.failed")));
    } finally {
      setProcessing(false);
    }
  };

  const switchSourceMode = (mode: SourceMode) => {
    setSourceMode(mode);
    setLines([]);
    setSelectedSale(null);
    setReturnPartnerId(mode === "manual" ? partnerId : null);
    setReturnPartnerName(null);
    setError("");
  };

  const keypadLine = lines.find((line) => line.regosItemId === keypadFor);

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        title={t("returns.modal.title")}
        fullscreen
        bodyClassName={styles.modalBody}
      >
        {step === "done" && successCode ? (
          <div className={styles.successBox}>
            <Undo2 size={32} className={styles.successIcon} />
            <div className={styles.successTitle}>{t("returns.modal.completed")}</div>
            <div className={styles.successCode}>#{successCode}</div>
            <div className={styles.successMeta}>
              {t("returns.modal.refundTotal")}: {formatCurrency(total)}
            </div>
            <Button full onClick={handleClose}>
              {t("common.done")}
            </Button>
          </div>
        ) : step === "payment" ? (
          <div className={styles.paymentStep}>
            <div className={styles.totalLine}>
              <span>{t("returns.modal.refundTotal")}</span>
              <span>{formatAmountWithCurrency(total, returnCurrency)}</span>
            </div>

            {canChangePartnerPerm && (
              <div className={styles.partnerRow}>
                <span className={styles.partnerLabel}>{t("returns.modal.customer")}</span>
                <button
                  type="button"
                  className={styles.partnerBtn}
                  onClick={() => setPartnerPickerOpen(true)}
                >
                  {returnPartnerName ??
                    (effectivePartnerId
                      ? t("returns.modal.partnerId", undefined, { id: effectivePartnerId })
                      : t("returns.modal.selectPartner"))}
                </button>
              </div>
            )}

            {error && <div className={styles.error}>{error}</div>}

            <PaymentPanel
              mode="return"
              total={total}
              saleCurrency={returnCurrency}
              accessToken={accessToken}
              active={open && step === "payment"}
              processing={processing}
              onConfirm={(payload) => void submitReturn(payload)}
            />

            <Button variant="ghost" full onClick={() => setStep("items")} disabled={processing}>
              {t("returns.modal.backToItems")}
            </Button>
          </div>
        ) : (
          <div className={styles.modalShell}>
            <div className={styles.modalScroll}>
              <div className={styles.sourceTabs}>
                <button
                  type="button"
                  className={clsx(styles.sourceTab, sourceMode === "sale" && styles.sourceTabActive)}
                  onClick={() => switchSourceMode("sale")}
                >
                  {t("returns.modal.fromSale")}
                </button>
                <button
                  type="button"
                  className={clsx(styles.sourceTab, sourceMode === "manual" && styles.sourceTabActive)}
                  onClick={() => switchSourceMode("manual")}
                >
                  {t("returns.modal.manual")}
                </button>
              </div>

              {sourceMode === "sale" ? (
                <>
                  {!selectedSale ? (
                    <>
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
                          placeholder={t("returns.modal.searchSales")}
                          value={saleSearch}
                          onChange={(e) => setSaleSearch(e.target.value)}
                        />
                      </div>
                      {documentsLoading ? (
                        <div className={styles.status}>{t("returns.modal.loadingSales")}</div>
                      ) : filteredDocuments.length === 0 ? (
                        <div className={styles.status}>{t("returns.modal.noSales")}</div>
                      ) : (
                        <div className={styles.modalSaleList}>
                          {filteredDocuments.map((doc) => (
                            <button
                              key={doc.id}
                              type="button"
                              className={styles.saleRow}
                              onClick={() => void selectSale(doc)}
                            >
                              <div>
                                <div className={styles.saleCode}>{doc.code}</div>
                                <div className={styles.saleMeta}>
                                  {formatDateTime(new Date(doc.date * 1000).toISOString())}
                                  {doc.partner_name ? ` · ${doc.partner_name}` : ""}
                                </div>
                              </div>
                              <div className={styles.saleAmount}>
                                {formatAmountWithCurrency(doc.amount ?? 0, doc.currency)}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className={styles.selectedSale}>
                        <div>
                          <strong>{selectedSale.code}</strong>
                          {selectedSale.partner_name ? ` · ${selectedSale.partner_name}` : ""}
                        </div>
                        <button
                          type="button"
                          className={styles.changeSaleBtn}
                          onClick={() => {
                            setSelectedSale(null);
                            setLines([]);
                          }}
                        >
                          {t("returns.modal.changeSale")}
                        </button>
                      </div>
                      <div className={styles.modalItemList}>
                        {lines.map((line) => {
                          const max = line.maxQty ?? 0;
                          const allReturned = max === 0;
                          return (
                            <div key={line.regosItemId} className={styles.itemRow}>
                              <div>
                                <div className={styles.itemName}>
                                  {line.name}
                                  {allReturned && (
                                    <span className={styles.refunded}>{t("returns.modal.fullyReturned")}</span>
                                  )}
                                </div>
                                <div className={styles.itemMeta}>
                                  {formatAmountWithCurrency(line.price, returnCurrency)} {t("returns.modal.ea")} · {t("returns.modal.sold")} {line.soldQty}
                                  {(line.returnedQty ?? 0) > 0 &&
                                    ` · ${line.returnedQty} ${t("returns.modal.alreadyReturned")}`}
                                </div>
                              </div>
                              <button
                                type="button"
                                className={styles.qtyTap}
                                onClick={() => !allReturned && setKeypadFor(line.regosItemId)}
                                disabled={allReturned}
                              >
                                {line.qty}
                              </button>
                              <div className={styles.itemMeta}>/ {max}</div>
                              <div className={styles.amount}>
                                {formatAmountWithCurrency(line.price * line.qty, returnCurrency)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <form
                    className={styles.searchBox}
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitManualProductSearch(productSearch.trim());
                    }}
                  >
                    <Search size={16} />
                    <input
                      className={styles.searchInput}
                      placeholder={t("returns.modal.searchProducts")}
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                    />
                  </form>
                  {!isBarcodeMode && searchLoading && (
                    <div className={styles.status}>{t("returns.modal.searching")}</div>
                  )}
                  {!isBarcodeMode &&
                    debouncedProductSearch.length >= 2 &&
                    !searchLoading &&
                    searchResults.length === 0 && (
                    <div className={styles.status}>{t("returns.modal.noProducts")}</div>
                  )}
                  {!isBarcodeMode && searchResults.length > 0 && (
                    <div className={styles.modalSearchResults}>
                      {searchResults.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          className={styles.searchResultRow}
                          onClick={() => addManualProduct(product)}
                        >
                          <span>{product.name}</span>
                          <span>{formatCurrency(product.price)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {lines.length > 0 && (
                    <div className={styles.modalItemList}>
                      {lines.map((line) => (
                        <div key={line.regosItemId} className={styles.itemRow}>
                          <div>
                            <div className={styles.itemName}>
                              {line.name}
                              <button
                                type="button"
                                className={styles.removeLineBtn}
                                onClick={() => removeManualLine(line.regosItemId)}
                              >
                                {t("common.remove")}
                              </button>
                            </div>
                            <div className={styles.itemMeta}>
                              {formatCurrency(line.price)} {t("returns.modal.ea")}
                            </div>
                          </div>
                          <button
                            type="button"
                            className={styles.qtyTap}
                            onClick={() => setKeypadFor(line.regosItemId)}
                          >
                            {line.qty}
                          </button>
                          <div />
                          <div className={styles.amount}>
                            {formatCurrency(line.price * line.qty)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className={styles.modalFooter}>
              <textarea
                className={styles.reason}
                rows={2}
                placeholder={t("returns.modal.reasonPlaceholder")}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />

              <div className={styles.summary}>
                <span>{t("returns.modal.refundTotal")}</span>
                <span>{formatAmountWithCurrency(total, returnCurrency)}</span>
              </div>

              {error && <div className={styles.error}>{error}</div>}

              <div className={styles.actions}>
                <Button variant="ghost" full onClick={handleClose}>
                  {t("common.cancel")}
                </Button>
                <Button
                  full
                  disabled={selectedLines.length === 0}
                  onClick={() => setStep("payment")}
                >
                  {t("returns.modal.continueToRefund")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {keypadLine && (
          <QtyKeypad
            open={keypadFor !== null}
            initial={keypadLine.qty}
            productName={`${keypadLine.name}${keypadLine.maxQty !== undefined ? ` · ${t("returns.modal.maxQty", undefined, { n: keypadLine.maxQty })}` : ""}`}
            onClose={() => setKeypadFor(null)}
            onConfirm={(n) => {
              setLineQty(keypadLine.regosItemId, n);
              setKeypadFor(null);
            }}
          />
        )}
      </Modal>

      <DashboardPeriodModal
        open={periodModalOpen}
        onClose={() => setPeriodModalOpen(false)}
        initialRange={periodModalRange}
        onApply={(range) => {
          setCustomRange(range);
          setPeriodPreset("custom");
        }}
      />

      {canChangePartnerPerm && accessToken && (
        <PartnerPickerModal
          open={partnerPickerOpen}
          onClose={() => setPartnerPickerOpen(false)}
          token={accessToken}
          selectedPartnerId={returnPartnerId ?? partnerId}
          onSelect={(partner) => {
            setReturnPartnerId(partner.id);
            setReturnPartnerName(partner.name);
            setPartnerPickerOpen(false);
          }}
          onPartnersChanged={() => refreshPartnerOptions(accessToken)}
        />
      )}
    </>
  );
}
