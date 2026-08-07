import { useMemo, useState } from "react";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { StockDocDateTimeField } from "@/components/StockDocs/StockDocDateTimeField";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  createStockDocument,
  type StockDocKind,
  type StockDocumentCreateRequest,
} from "@/lib/stock-docs-api";
import { getStockDocDefinition } from "@/lib/stock-doc-definitions";
import {
  fromDatetimeRuValue,
  INVENTORY_COMPARE_TYPES,
  isValidCompareType,
  nowDatetimeRuValue,
  type InventoryCompareType,
} from "@/lib/stock-doc-form";
import { formatAuthError, useAuth } from "@/store/auth";
import { useSellContext } from "@/store/sell-context";
import {
  getVatCalculationTypeOptions,
  type RegosDefaultOption,
  type RegosPriceTypeOption,
  type VatCalculationType,
} from "@/types/settings";
import styles from "./StockDocs.module.css";

type Props = {
  kind: StockDocKind;
  warehouses: RegosDefaultOption[];
  partners: RegosDefaultOption[];
  priceTypes: RegosPriceTypeOption[];
  defaultVatCalculationType?: VatCalculationType;
  onClose: () => void;
  onCreated: (id: number) => void;
};

export function StockDocCreateModal({
  kind,
  warehouses,
  partners,
  priceTypes,
  defaultVatCalculationType = "No",
  onClose,
  onCreated,
}: Props) {
  const def = getStockDocDefinition(kind);
  const { t } = useLanguage();
  const token = useAuth((s) => s.accessToken);
  const sellWarehouseId = useSellContext((s) => s.warehouseId);
  const sellPartnerId = useSellContext((s) => s.partnerId);
  const sellPriceTypeId = useSellContext((s) => s.priceTypeId);

  const needsPriceType =
    kind === "purchase" || kind === "inventory" || kind === "return_to_partner";
  const needsCurrencyVat = kind === "purchase" || kind === "return_to_partner";
  const vatOptions = useMemo(() => getVatCalculationTypeOptions(t), [t]);

  const defaultStock = useMemo(() => {
    if (sellWarehouseId && warehouses.some((w) => w.id === sellWarehouseId)) {
      return sellWarehouseId;
    }
    return warehouses[0]?.id ?? 0;
  }, [sellWarehouseId, warehouses]);

  const defaultPartner = useMemo(() => {
    if (sellPartnerId && partners.some((p) => p.id === sellPartnerId)) {
      return sellPartnerId;
    }
    return partners[0]?.id ?? 0;
  }, [partners, sellPartnerId]);

  const defaultPriceType = useMemo(() => {
    if (sellPriceTypeId && priceTypes.some((p) => p.id === sellPriceTypeId)) {
      return sellPriceTypeId;
    }
    return priceTypes[0]?.id ?? 0;
  }, [priceTypes, sellPriceTypeId]);

  const [partnerId, setPartnerId] = useState(defaultPartner);
  const [stockId, setStockId] = useState(defaultStock);
  const [senderId, setSenderId] = useState(defaultStock);
  const [receiverId, setReceiverId] = useState(
    warehouses.find((w) => w.id !== defaultStock)?.id ?? defaultStock,
  );
  const [inoutType, setInoutType] = useState<"income" | "outcome">("income");
  const [dateTimeValue, setDateTimeValue] = useState(nowDatetimeRuValue);
  const [priceTypeId, setPriceTypeId] = useState(defaultPriceType);
  const [vatCalculationType, setVatCalculationType] =
    useState<VatCalculationType>(defaultVatCalculationType);
  const [compareType, setCompareType] = useState<InventoryCompareType>("open_date");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectedPriceType = useMemo(
    () => priceTypes.find((p) => p.id === priceTypeId) ?? null,
    [priceTypeId, priceTypes],
  );
  const currencyLabel = selectedPriceType?.currency
    ? selectedPriceType.currency.code_chr || selectedPriceType.currency.name
    : "—";

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
    if (needsCurrencyVat && !selectedPriceType?.currency?.id) {
      setError(t("stock.errors.currencyRequired", "Selected price type has no currency"));
      return;
    }

    setBusy(true);
    setError("");
    try {
      let body: StockDocumentCreateRequest;
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
          body.currency_id = selectedPriceType?.currency?.id;
        } else if (kind === "return_to_partner") {
          body.vat_calculation_type = vatCalculationType;
          body.currency_id = selectedPriceType?.currency?.id;
        } else if (kind === "wholesale" && sellPriceTypeId) {
          body.price_type_id = sellPriceTypeId;
        }
      }

      const res = await createStockDocument(token, kind, body);
      onCreated(res.id);
    } catch (err: unknown) {
      setError(formatAuthError(err, t("stock.errors.create", "Failed to create document")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t("stock.create.title", "New {{kind}}", {
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
          {t("common.create", "Create")}
        </Button>
      </div>
    </Modal>
  );
}
