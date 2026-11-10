import clsx from "clsx";
import { Check, Minus, Plus } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatAmountWithCurrency } from "@/lib/checkout-payments";
import { PRODUCT_FALLBACK_IMAGE } from "@/lib/product-image";
import { useSellContext } from "@/store/sell-context";
import type { Product } from "@/types/catalog";
import posStyles from "@/components/POS/POS.module.css";
import styles from "./Products.module.css";

type Props = {
  product: Product;
  selected: boolean;
  hideCardImages: boolean;
  onToggle: (product: Product) => void;
  showCopies?: boolean;
  copies?: number;
  onCopiesChange?: (product: Product, copies: number) => void;
  onCopiesKeypad?: (product: Product) => void;
};

function productDisplayName(product: Product): string {
  const unitName = product.unit_name != null ? String(product.unit_name).trim() : "";
  if (!unitName) return product.name;
  return `${product.name} (${unitName})`;
}

function productCodeLine(product: Product): string {
  const parts = [product.code, product.articul, product.barcode]
    .map((value) => (value != null ? String(value).trim() : ""))
    .filter(Boolean);
  if (parts.length > 0) return parts.join(" · ");
  return product.sku != null ? String(product.sku) : "";
}

function clampCopies(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(99, Math.max(1, Math.round(value)));
}

export function LabelProductCard({
  product,
  selected,
  hideCardImages,
  onToggle,
  showCopies = false,
  copies = 1,
  onCopiesChange,
  onCopiesKeypad,
}: Props) {
  const { t } = useLanguage();
  const saleCurrency = useSellContext((state) => state.saleCurrency);
  const out = product.stock <= 0;
  const low = product.stock > 0 && product.stock < 10;
  const stockText = Number.isInteger(product.stock)
    ? t("pos.stockLeft", "{{n}} left", { n: product.stock })
    : t("pos.stockLeft", "{{n}} left", { n: product.stock.toFixed(2).replace(/\.?0+$/, "") });
  const check = selected ? (
    <span
      className={clsx(styles.check, styles.checkOn, hideCardImages && styles.checkInline)}
      aria-hidden
    >
      <Check size={16} strokeWidth={3} />
    </span>
  ) : null;

  const copiesControl =
    showCopies && onCopiesChange ? (
      <div
        className={styles.copiesControl}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className={styles.copiesBtn}
          aria-label={t("products.copiesDecrease", "Decrease label copies")}
          disabled={copies <= 1}
          onClick={() => onCopiesChange(product, clampCopies(copies - 1))}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          className={styles.copiesValue}
          aria-label={t("cart.qty.tapToEnter", "Tap to enter quantity")}
          title={t("cart.qty.tapToEnter", "Tap to enter quantity")}
          onClick={() => onCopiesKeypad?.(product)}
        >
          {copies}
        </button>
        <button
          type="button"
          className={styles.copiesBtn}
          aria-label={t("products.copiesIncrease", "Increase label copies")}
          disabled={copies >= 99}
          onClick={() => onCopiesChange(product, clampCopies(copies + 1))}
        >
          <Plus size={14} />
        </button>
      </div>
    ) : null;

  return (
    <div
      className={clsx(
        posStyles.card,
        styles.card,
        hideCardImages && posStyles.cardNoImage,
        selected && styles.cardSelected,
      )}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onToggle(product)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle(product);
        }
      }}
    >
      {hideCardImages ? null : check}
      {hideCardImages ? null : (
        <div className={posStyles.cardMedia}>
          <img className={posStyles.cardImg} src={product.image || PRODUCT_FALLBACK_IMAGE} alt="" />
        </div>
      )}
      <div className={posStyles.cardBody}>
        <div className={posStyles.cardBodyHead}>
          {hideCardImages ? check : null}
          <div className={posStyles.cardName}>{productDisplayName(product)}</div>
        </div>
        <div className={posStyles.cardCategory}>{product.category}</div>
        <div className={posStyles.cardSku}>{productCodeLine(product)}</div>
        <div className={posStyles.cardFoot}>
          <div className={posStyles.cardPrice}>
            {formatAmountWithCurrency(product.price, saleCurrency)}
          </div>
          <span
            className={clsx(
              posStyles.stockBadge,
              out && posStyles.stockOut,
              low && posStyles.stockLow,
            )}
          >
            {out ? t("pos.outOfStock", "Out") : stockText}
          </span>
        </div>
        {copiesControl}
      </div>
    </div>
  );
}
