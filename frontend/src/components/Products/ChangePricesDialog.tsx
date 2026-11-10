import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/posui/Button";
import { Modal } from "@/components/posui/Modal";
import { useLanguage } from "@/contexts/LanguageContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatAmountWithCurrency } from "@/lib/checkout-payments";
import { setProductPrices } from "@/lib/product-prices-api";
import { formatAuthError, useAuth } from "@/store/auth";
import { useSellContext } from "@/store/sell-context";
import type { Product } from "@/types/catalog";
import styles from "./Products.module.css";

type Props = {
  open: boolean;
  products: Product[];
  priceTypeId: number | null;
  onClose: () => void;
  onSaved: (updates: Array<{ id: string; price: number }>) => void;
};

const PRICE_EPSILON = 0.000001;

function formatPriceInput(price: number): string {
  if (!Number.isFinite(price)) return "";
  return String(price);
}

function parsePrice(raw: string): number | null {
  const normalized = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function itemId(product: Product): number {
  const raw = product.regos_item_id ?? Number(product.id);
  return Number.isInteger(raw) && raw > 0 ? raw : 0;
}

export function ChangePricesDialog({ open, products, priceTypeId, onClose, onSaved }: Props) {
  const { t } = useLanguage();
  const isMobile = useIsMobile();
  const token = useAuth((state) => state.accessToken);
  const saleCurrency = useSellContext((state) => state.saleCurrency);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const productsRef = useRef(products);
  productsRef.current = products;
  const draftKey = products.map((product) => `${product.id}:${product.price}`).join(",");

  useEffect(() => {
    if (!open) return;
    setDrafts(
      Object.fromEntries(
        productsRef.current.map((product) => [product.id, formatPriceInput(product.price)]),
      ),
    );
    setError("");
  }, [draftKey, open]);

  const parsed = useMemo(() => {
    const rows: Array<{ id: string; itemId: number; baseValue: number; newValue: number }> = [];
    let invalid = false;
    for (const product of products) {
      const next = parsePrice(drafts[product.id] ?? "");
      if (next == null || itemId(product) <= 0) {
        invalid = true;
        continue;
      }
      if (Math.abs(next - product.price) > PRICE_EPSILON) {
        rows.push({
          id: product.id,
          itemId: itemId(product),
          baseValue: product.price,
          newValue: next,
        });
      }
    }
    return { invalid, rows };
  }, [drafts, products]);

  const draftsReady =
    products.length > 0 && products.every((product) => Object.hasOwn(drafts, product.id));
  const canSave =
    Boolean(priceTypeId) && draftsReady && !parsed.invalid && parsed.rows.length > 0 && !saving;

  const save = async () => {
    if (!token || !priceTypeId || !canSave) return;
    setSaving(true);
    setError("");
    try {
      await setProductPrices(token, {
        price_type_id: priceTypeId,
        lines: parsed.rows.map((row) => ({
          item_id: row.itemId,
          base_value: row.baseValue,
          new_value: row.newValue,
        })),
      });
      onSaved(parsed.rows.map((row) => ({ id: row.id, price: row.newValue })));
    } catch (err: unknown) {
      setError(formatAuthError(err, t("products.errors.changePrices", "Failed to update prices")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={saving ? () => undefined : onClose}
      title={t("products.changePricesTitle", "Change prices")}
      size="lg"
      fullscreen={isMobile}
      bodyClassName={styles.priceDialogBody}
    >
      {!priceTypeId ? (
        <p className={styles.hint}>{t("products.priceTypeRequired", "Select a price type")}</p>
      ) : null}
      <div className={styles.priceList}>
        {products.map((product) => (
          <label key={product.id} className={styles.priceRow}>
            <span className={styles.priceName}>{product.name}</span>
            <span className={styles.priceCurrent}>
              {t("products.currentPrice", "Current price")}:{" "}
              {formatAmountWithCurrency(product.price, saleCurrency)}
            </span>
            <input
              className={styles.priceInput}
              inputMode="decimal"
              value={drafts[product.id] ?? ""}
              aria-label={t("products.newPrice", "New price for {{name}}", { name: product.name })}
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [product.id]: event.target.value }))
              }
            />
          </label>
        ))}
      </div>
      {draftsReady && parsed.invalid ? (
        <p className={styles.error}>{t("products.errors.invalidPrice", "Enter a price of zero or greater.")}</p>
      ) : draftsReady && parsed.rows.length === 0 && priceTypeId ? (
        <p className={styles.hint}>{t("products.noPriceChanges", "Change at least one price.")}</p>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.dialogActions}>
        <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
          {t("common.cancel", "Cancel")}
        </Button>
        <Button type="button" disabled={!canSave} onClick={() => void save()}>
          {saving ? t("products.savingPrices", "Saving…") : t("common.save", "Save")}
        </Button>
      </div>
    </Modal>
  );
}
