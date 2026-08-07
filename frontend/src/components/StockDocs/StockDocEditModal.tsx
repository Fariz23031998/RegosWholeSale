import { useMemo, useState } from "react";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { StockDocDateTimeField } from "@/components/StockDocs/StockDocDateTimeField";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  updateStockDocument,
  type StockDocKind,
  type StockDocument,
  type StockDocumentUpdateRequest,
} from "@/lib/stock-docs-api";
import { getStockDocDefinition } from "@/lib/stock-doc-definitions";
import {
  fromDatetimeRuValue,
  INVENTORY_COMPARE_TYPES,
  isValidCompareType,
  isValidVatCalculationType,
  toDatetimeRuValue,
  type InventoryCompareType,
} from "@/lib/stock-doc-form";
import { formatAuthError, useAuth } from "@/store/auth";
import {
  getVatCalculationTypeOptions,
  type RegosDefaultOption,
  type RegosPriceTypeOption,
  type VatCalculationType,
} from "@/types/settings";
import styles from "./StockDocs.module.css";

type Props = {
  kind: StockDocKind;
  document: StockDocument;
  warehouses: RegosDefaultOption[];
  partners: RegosDefaultOption[];
  priceTypes: RegosPriceTypeOption[];
  onClose: () => void;
  onSaved: () => void;
};

export function StockDocEditModal({
  kind,
  document,
  warehouses,
  partners,
  priceTypes,
  onClose,
  onSaved,
}: Props) {
  const def = getStockDocDefinition(kind);
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const needsPriceType =
    kind === "purchase" || kind === "inventory" || kind === "return_to_partner";
  const needsCurrencyVat = kind === "purchase" || kind === "return_to_partner";
  const vatOptions = useMemo(() => getVatCalculationTypeOptions(t), [t]);

  const initialPriceType =
    (document.price_type_id &&
      priceTypes.some((p) => p.id === document.price_type_id) &&
      document.price_type_id) ||
    priceTypes[0]?.id ||
    0;

  const initialVat: VatCalculationType =
    document.vat_calculation_type && isValidVatCalculationType(document.vat_calculation_type)
      ? document.vat_calculation_type
      : "No";

  const initialCompare: InventoryCompareType =
    document.compare_type && isValidCompareType(document.compare_type)
      ? document.compare_type
      : "open_date";

  const [partnerId, setPartnerId] = useState(document.partner_id ?? partners[0]?.id ?? 0);
  const [stockId, setStockId] = useState(document.stock_id ?? warehouses[0]?.id ?? 0);
  const [senderId, setSenderId] = useState(
    document.stock_sender_id ?? document.stock_id ?? warehouses[0]?.id ?? 0,
  );
  const [receiverId, setReceiverId] = useState(
    document.stock_receiver_id ??
      warehouses.find((w) => w.id !== (document.stock_sender_id ?? document.stock_id))?.id ??
      warehouses[0]?.id ??
      0,
  );
  const [inoutType, setInoutType] = useState<"income" | "outcome">(
    document.inout_type === "outcome" ? "outcome" : "income",
  );
  const [dateTimeValue, setDateTimeValue] = useState(() =>
    toDatetimeRuValue(document.date > 0 ? document.date : Math.floor(Date.now() / 1000)),
  );
  const [priceTypeId, setPriceTypeId] = useState(initialPriceType);
  const [vatCalculationType, setVatCalculationType] = useState<VatCalculationType>(initialVat);
  const [compareType, setCompareType] = useState<InventoryCompareType>(initialCompare);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectedPriceType = useMemo(
    () => priceTypes.find((p) => p.id === priceTypeId) ?? null,
    [priceTypeId, priceTypes],
  );
  const currencyLabel = selectedPriceType?.currency
    ? selectedPriceType.currency.code_chr || selectedPriceType.currency.name
    : document.currency?.code_chr || document.currency?.name || "—";

  const submit = async () => {
    if (!token || busy) return;
    const date = fromDatetimeRuValue(dateTimeValue);
    if (date == null) {
      setError(
        t(
          "stock.errors.invalidDate",
          "Enter a valid date and time (dd.MM.yyyy HH:MM)",
        ),
      );
      return;
    }
    if (needsPriceType && !priceTypeId) {
      setError(t("stock.errors.priceTypeRequired", "Select a price type"));
      return;
    }
    if (
      needsCurrencyVat &&
      !selectedPriceType?.currency?.id &&
      !document.currency?.id
    ) {
      setError(t("stock.errors.currencyRequired", "Selected price type has no currency"));
      return;
    }

    setBusy(true);
    setError("");
    try {
      let body: StockDocumentUpdateRequest;
      if (kind === "movement") {
        body = {
          stock_sender_id: senderId,
          stock_receiver_id: receiverId,
          date,
        };
      } else if (kind === "inventory") {
        body = {
          stock_id: stockId,
          date,
          price_type_id: priceTypeId,
          compare_type: compareType,
        };
      } else if (kind === "inout") {
        body = {
          stock_id: stockId,
          inout_type: inoutType,
          date,
        };
      } else {
        body = {
          partner_id: partnerId,
          stock_id: stockId,
          date,
        };
        if (kind === "purchase") {
          body.price_type_id = priceTypeId;
          body.vat_calculation_type = vatCalculationType;
          body.currency_id =
            selectedPriceType?.currency?.id ?? document.currency?.id ?? undefined;
        } else if (kind === "return_to_partner") {
          body.vat_calculation_type = vatCalculationType;
          body.currency_id =
            selectedPriceType?.currency?.id ?? document.currency?.id ?? undefined;
        } else if (kind === "wholesale" && document.price_type_id) {
          body.price_type_id = document.price_type_id;
        }
      }

      await updateStockDocument(token, kind, document.id, body);
      onSaved();
    } catch (err: unknown) {
      setError(formatAuthError(err, t("stock.errors.update", "Failed to update document")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t("stock.edit.title", "Edit {{kind}}", {
        kind: t(def.titleKey, def.titleFallback),
      })}
    >
      <div className={styles.formGrid}>
        <StockDocDateTimeField value={dateTimeValue} onChange={setDateTimeValue} />

        {kind === "movement" ? (
          <>
            <div className={styles.formField}>
              <label>{t("stock.table.sender", "From")}</label>
              <select
                value={senderId}
                onChange={(e) => setSenderId(Number(e.target.value))}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.formField}>
              <label>{t("stock.table.receiver", "To")}</label>
              <select
                value={receiverId}
                onChange={(e) => setReceiverId(Number(e.target.value))}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <>
            {def.supportsPartnerFilter && (
              <div className={styles.formField}>
                <label>{t("stock.table.partner", "Partner")}</label>
                <select
                  value={partnerId}
                  onChange={(e) => setPartnerId(Number(e.target.value))}
                >
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={styles.formField}>
              <label>{t("stock.table.warehouse", "Warehouse")}</label>
              <select value={stockId} onChange={(e) => setStockId(Number(e.target.value))}>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            {kind === "inout" && (
              <div className={styles.formField}>
                <label>{t("stock.table.inoutType", "Type")}</label>
                <select
                  value={inoutType}
                  onChange={(e) => setInoutType(e.target.value as "income" | "outcome")}
                >
                  <option value="income">{t("stock.inout.income", "Receipt")}</option>
                  <option value="outcome">{t("stock.inout.outcome", "Write-off")}</option>
                </select>
              </div>
            )}
          </>
        )}

        {needsPriceType ? (
          <div className={styles.formField}>
            <label>{t("stock.fields.priceType", "Price type")}</label>
            <select
              value={priceTypeId}
              onChange={(e) => setPriceTypeId(Number(e.target.value))}
            >
              {priceTypes.length === 0 ? (
                <option value={0}>{t("common.nothing", "Nothing found")}</option>
              ) : (
                priceTypes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              )}
            </select>
          </div>
        ) : null}

        {needsCurrencyVat ? (
          <>
            <div className={styles.formField}>
              <label>{t("stock.fields.currency", "Currency")}</label>
              <input type="text" value={currencyLabel} readOnly disabled />
            </div>
            <div className={styles.formField}>
              <label>{t("stock.fields.vatCalculationType", "VAT calculation type")}</label>
              <select
                value={vatCalculationType}
                onChange={(e) => setVatCalculationType(e.target.value as VatCalculationType)}
              >
                {vatOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}

        {kind === "inventory" ? (
          <div className={styles.formField}>
            <label>{t("stock.fields.compareType", "Compare type")}</label>
            <select
              value={compareType}
              onChange={(e) => {
                const value = e.target.value;
                if (isValidCompareType(value)) setCompareType(value);
              }}
            >
              {INVENTORY_COMPARE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(`stock.compareType.${value}`, value)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      {error ? <div className={styles.error}>{error}</div> : null}
      <div className={styles.formActions}>
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          {t("common.cancel", "Cancel")}
        </Button>
        <Button type="button" onClick={() => void submit()} disabled={busy}>
          {t("common.save", "Save")}
        </Button>
      </div>
    </Modal>
  );
}
