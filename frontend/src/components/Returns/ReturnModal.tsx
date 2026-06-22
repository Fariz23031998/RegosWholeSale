import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Undo2 } from "lucide-react";
import clsx from "clsx";
import { Modal } from "@/components/posui/Modal";
import { Button } from "@/components/posui/Button";
import { QtyKeypad } from "@/components/Cart/QtyKeypad";
import {
  PaymentPanel,
  type PaymentSubmitPayload,
} from "@/components/Checkout/PaymentPanel";
import { PartnerPickerModal } from "@/components/POS/PartnerPickerModal";
import { formatAuthError, useAuth } from "@/store/auth";
import { useSellContext } from "@/store/sell-context";
import { fetchCatalogProducts } from "@/lib/catalog-api";
import { formatAmountWithCurrency } from "@/lib/checkout-payments";
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

function rangeToTimestamps(): { start_date: number; end_date: number } {
  const now = Math.floor(Date.now() / 1000);
  const day = 24 * 60 * 60;
  return { start_date: now - 7 * day, end_date: now };
}

export function ReturnModal({ open, onClose }: Props) {
  const accessToken = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);
  const canOverrideRegos = Boolean(user?.permissions.includes("pos.override_regos"));
  const saleCurrency = useSellContext((s) => s.saleCurrency);
  const partnerId = useSellContext((s) => s.partnerId);
  const checkoutOverrides = useSellContext((s) => s.checkoutOverrides);
  const refreshPartnerOptions = useSellContext((s) => s.refreshPartnerOptions);
  const catalogQuery = useSellContext((s) => s.catalogQuery);

  const [sourceMode, setSourceMode] = useState<SourceMode>("sale");
  const [step, setStep] = useState<Step>("items");
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [reason, setReason] = useState("");
  const [keypadFor, setKeypadFor] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  const [saleSearch, setSaleSearch] = useState("");
  const [documents, setDocuments] = useState<WholesaleDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [selectedSale, setSelectedSale] = useState<WholesaleDocument | null>(null);

  const [productSearch, setProductSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

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
    setDocuments([]);
    setSelectedSale(null);
    setProductSearch("");
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
    void fetchWholesaleDocuments(accessToken, { ...rangeToTimestamps(), limit: 100 })
      .then((res) => {
        if (!cancelled) setDocuments(res.documents);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(formatAuthError(err, "Failed to load sales"));
      })
      .finally(() => {
        if (!cancelled) setDocumentsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, accessToken, sourceMode]);

  useEffect(() => {
    if (!open || !accessToken || sourceMode !== "manual") return;
    const q = productSearch.trim();
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
        if (!cancelled) setError(formatAuthError(err, "Product search failed"));
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, accessToken, sourceMode, productSearch, catalogQuery]);

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
          .map((op) => mapOperationToLine(op, returnedByItem.get(op.item_id) ?? 0)),
      );
    } catch (err: unknown) {
      setError(formatAuthError(err, "Failed to load sale details"));
      setSelectedSale(null);
    }
  };

  const mapOperationToLine = (
    op: WholesaleOperationLine,
    returnedQty: number,
  ): ReturnLine => {
    const soldQty = op.quantity;
    const remaining = Math.max(0, soldQty - returnedQty);
    return {
      regosItemId: op.item_id,
      name: op.item_name ?? `Item #${op.item_id}`,
      price: op.price,
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

  const addManualProduct = (product: Product) => {
    const regosItemId = product.regos_item_id ?? Number(product.id);
    if (!regosItemId || regosItemId <= 0) return;

    setLines((prev) => {
      const existing = prev.find((line) => line.regosItemId === regosItemId);
      if (existing) {
        return prev.map((line) =>
          line.regosItemId === regosItemId ? { ...line, qty: line.qty + 1 } : line,
        );
      }
      return [
        ...prev,
        {
          regosItemId,
          name: product.name,
          price: product.price,
          qty: 1,
        },
      ];
    });
    setProductSearch("");
    setSearchResults([]);
  };

  const removeManualLine = (regosItemId: number) => {
    setLines((prev) => prev.filter((line) => line.regosItemId !== regosItemId));
  };

  const selectedLines = lines.filter((line) => line.qty > 0);
  const total = +selectedLines.reduce((sum, line) => sum + line.price * line.qty, 0).toFixed(2);

  const effectivePartnerId =
    sourceMode === "sale" ? (selectedSale?.partner_id ?? returnPartnerId) : partnerId;

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
      const overridePartnerId = canOverrideRegos ? checkoutOverrides().partner_id : undefined;
      const resolvedPartnerId =
        (canOverrideRegos && returnPartnerId) ||
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
        ...(canOverrideRegos ? checkoutOverrides() : {}),
        ...(resolvedPartnerId ? { partner_id: resolvedPartnerId } : {}),
      });

      setSuccessCode(result.wholesale_return_code);
      setStep("done");
    } catch (err: unknown) {
      setError(formatAuthError(err, "Return failed"));
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
        title="Return products"
        size="lg"
      >
        {step === "done" && successCode ? (
          <div className={styles.successBox}>
            <Undo2 size={32} className={styles.successIcon} />
            <div className={styles.successTitle}>Return completed</div>
            <div className={styles.successCode}>#{successCode}</div>
            <div className={styles.successMeta}>
              Refund total: {formatCurrency(total)}
            </div>
            <Button full onClick={handleClose}>
              Done
            </Button>
          </div>
        ) : step === "payment" ? (
          <div className={styles.paymentStep}>
            <div className={styles.totalLine}>
              <span>Refund total</span>
              <span>{formatAmountWithCurrency(total, saleCurrency)}</span>
            </div>

            {canOverrideRegos && (
              <div className={styles.partnerRow}>
                <span className={styles.partnerLabel}>Customer</span>
                <button
                  type="button"
                  className={styles.partnerBtn}
                  onClick={() => setPartnerPickerOpen(true)}
                >
                  {returnPartnerName ??
                    (effectivePartnerId ? `Partner #${effectivePartnerId}` : "Select partner")}
                </button>
              </div>
            )}

            {error && <div className={styles.error}>{error}</div>}

            <PaymentPanel
              mode="return"
              total={total}
              saleCurrency={saleCurrency}
              accessToken={accessToken}
              active={open && step === "payment"}
              processing={processing}
              onConfirm={(payload) => void submitReturn(payload)}
            />

            <Button variant="ghost" full onClick={() => setStep("items")} disabled={processing}>
              Back to items
            </Button>
          </div>
        ) : (
          <>
            <div className={styles.sourceTabs}>
              <button
                type="button"
                className={clsx(styles.sourceTab, sourceMode === "sale" && styles.sourceTabActive)}
                onClick={() => switchSourceMode("sale")}
              >
                From sale
              </button>
              <button
                type="button"
                className={clsx(styles.sourceTab, sourceMode === "manual" && styles.sourceTabActive)}
                onClick={() => switchSourceMode("manual")}
              >
                Manual
              </button>
            </div>

            {sourceMode === "sale" ? (
              <>
                {!selectedSale ? (
                  <>
                    <div className={styles.searchBox}>
                      <Search size={16} />
                      <input
                        className={styles.searchInput}
                        placeholder="Search sales by code or customer…"
                        value={saleSearch}
                        onChange={(e) => setSaleSearch(e.target.value)}
                      />
                    </div>
                    {documentsLoading ? (
                      <div className={styles.status}>Loading sales…</div>
                    ) : filteredDocuments.length === 0 ? (
                      <div className={styles.status}>No sales found for the last 7 days.</div>
                    ) : (
                      <div className={styles.saleList}>
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
                              {formatCurrency(doc.amount ?? 0)}
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
                        Change sale
                      </button>
                    </div>
                    {lines.map((line) => {
                      const max = line.maxQty ?? 0;
                      const allReturned = max === 0;
                      return (
                        <div key={line.regosItemId} className={styles.itemRow}>
                          <div>
                            <div className={styles.itemName}>
                              {line.name}
                              {allReturned && (
                                <span className={styles.refunded}>fully returned</span>
                              )}
                            </div>
                            <div className={styles.itemMeta}>
                              {formatCurrency(line.price)} ea · sold {line.soldQty}
                              {(line.returnedQty ?? 0) > 0 &&
                                ` · ${line.returnedQty} already returned`}
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
                            {formatCurrency(line.price * line.qty)}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </>
            ) : (
              <>
                <div className={styles.searchBox}>
                  <Search size={16} />
                  <input
                    className={styles.searchInput}
                    placeholder="Search products by name or SKU…"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                  />
                </div>
                {searchLoading && <div className={styles.status}>Searching…</div>}
                {productSearch.trim().length >= 2 && !searchLoading && searchResults.length === 0 && (
                  <div className={styles.status}>No products found.</div>
                )}
                {searchResults.length > 0 && (
                  <div className={styles.searchResults}>
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
                  <div className={styles.manualLines}>
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
                              Remove
                            </button>
                          </div>
                          <div className={styles.itemMeta}>{formatCurrency(line.price)} ea</div>
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

            <textarea
              className={styles.reason}
              rows={2}
              placeholder="Reason for return (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />

            <div className={styles.summary}>
              <span>Refund total</span>
              <span>{formatCurrency(total)}</span>
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.actions}>
              <Button variant="ghost" full onClick={handleClose}>
                Cancel
              </Button>
              <Button
                full
                disabled={selectedLines.length === 0}
                onClick={() => setStep("payment")}
              >
                Continue to refund
              </Button>
            </div>
          </>
        )}

        {keypadLine && (
          <QtyKeypad
            open={keypadFor !== null}
            initial={keypadLine.qty}
            productName={`${keypadLine.name}${keypadLine.maxQty !== undefined ? ` · max ${keypadLine.maxQty}` : ""}`}
            onClose={() => setKeypadFor(null)}
            onConfirm={(n) => {
              setLineQty(keypadLine.regosItemId, n);
              setKeypadFor(null);
            }}
          />
        )}
      </Modal>

      {canOverrideRegos && accessToken && (
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
