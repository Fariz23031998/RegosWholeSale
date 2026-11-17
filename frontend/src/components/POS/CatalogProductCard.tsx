import { memo, startTransition } from "react";
import clsx from "clsx";
import { Star } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { canFitBaseQtyInCart } from "@/lib/cart-stock";
import { formatAmountWithCurrency } from "@/lib/checkout-payments";
import { amountInSaleCurrency } from "@/lib/currency-conversion";
import { formatCurrency } from "@/lib/format";
import { PRODUCT_FALLBACK_IMAGE } from "@/lib/product-image";
import { useCart } from "@/store/cart";
import { usePosConfig } from "@/store/pos-config";
import { useSellContext } from "@/store/sell-context";
import type { Product } from "@/types/catalog";
import styles from "./POS.module.css";

type CatalogViewMode = "single" | "double" | "list";

type CatalogProductCardProps = {
  product: Product;
  categoryName: string;
  hideCardImages: boolean;
  isFeatured: boolean;
  isMobile: boolean;
  view: CatalogViewMode;
  allowOutOfStock: boolean;
  reservedInOtherTabs: number;
  bookedOrderContinuation: boolean;
  /** Main-unit qty required for one add (1, or conversion factor when defaulting to secondary). */
  minAddBaseQty?: number;
  onAdd: (product: Product) => void;
  onToggleFeatured: (product: Product) => void;
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

export const CatalogProductCard = memo(function CatalogProductCard({
  product,
  categoryName,
  hideCardImages,
  isFeatured,
  isMobile,
  view,
  allowOutOfStock,
  reservedInOtherTabs,
  bookedOrderContinuation,
  minAddBaseQty = 1,
  onAdd,
  onToggleFeatured,
}: CatalogProductCardProps) {
  const { t } = useLanguage();
  const saleCurrency = useSellContext((state) => state.saleCurrency);
  const priceCurrency = useSellContext((state) => state.priceCurrency);
  const showLastPurchaseCost = usePosConfig((state) => state.showLastPurchaseCost);
  const inCartQty = useCart(
    (state) => state.items.find((item) => item.productId === product.id)?.qty ?? 0,
  );

  const cannotAdd = !canFitBaseQtyInCart(
    product,
    inCartQty,
    minAddBaseQty,
    allowOutOfStock,
    reservedInOtherTabs,
    bookedOrderContinuation ? { bookedOrderContinuation: true } : undefined,
  );
  const displayStock = product.stock;
  const out = displayStock <= 0;
  const low = displayStock > 0 && displayStock < 10;
  const stockText = Number.isInteger(displayStock)
    ? t("pos.stockLeft", "{{n}} left", { n: displayStock })
    : t("pos.stockLeft", "{{n}} left", {
        n: displayStock.toFixed(2).replace(/\.?0+$/, ""),
      });

  return (
    <div
      className={clsx(
        styles.card,
        hideCardImages && styles.cardNoImage,
        cannotAdd && styles.cardDisabled,
      )}
      role="button"
      tabIndex={cannotAdd ? -1 : 0}
      aria-disabled={cannotAdd}
      onClick={() => {
        if (cannotAdd) return;
        startTransition(() => onAdd(product));
      }}
      onKeyDown={(event) => {
        if (cannotAdd) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          startTransition(() => onAdd(product));
        }
      }}
    >
      {!hideCardImages ? (
        <div className={styles.cardMedia}>
          <img
            src={product.image || PRODUCT_FALLBACK_IMAGE}
            alt={product.name}
            className={styles.cardImg}
            loading="lazy"
          />
          <button
            type="button"
            className={clsx(styles.featureBtn, isFeatured && styles.featureBtnActive)}
            aria-label={
              isFeatured
                ? t("pos.featuredRemove", "Remove from featured")
                : t("pos.featuredAdd", "Add to featured")
            }
            aria-pressed={isFeatured}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFeatured(product);
            }}
          >
            <Star size={15} fill={isFeatured ? "currentColor" : "none"} />
          </button>
        </div>
      ) : null}
      <div className={styles.cardBody}>
        <div className={styles.cardBodyHead}>
          <div className={styles.cardName}>{productDisplayName(product)}</div>
          {hideCardImages ? (
            <button
              type="button"
              className={clsx(
                styles.featureBtn,
                styles.featureBtnInline,
                isFeatured && styles.featureBtnActive,
              )}
              aria-label={
                isFeatured
                  ? t("pos.featuredRemove", "Remove from featured")
                  : t("pos.featuredAdd", "Add to featured")
              }
              aria-pressed={isFeatured}
              onClick={(event) => {
                event.stopPropagation();
                onToggleFeatured(product);
              }}
            >
              <Star size={15} fill={isFeatured ? "currentColor" : "none"} />
            </button>
          ) : null}
        </div>
        <div className={styles.cardCategory}>{categoryName}</div>
        <div className={styles.cardSku}>{productCodeLine(product)}</div>
        <div className={styles.cardFoot}>
          <div className={styles.cardPriceBlock}>
            <div className={styles.cardPrice}>
              {formatAmountWithCurrency(
                amountInSaleCurrency(product.price, priceCurrency, saleCurrency),
                saleCurrency,
              )}
            </div>
            {showLastPurchaseCost ? (
              <div className={styles.cardCost}>
                {t("stock.detail.table.cost", "Cost")}:{" "}
                {product.last_purchase_cost != null
                  ? formatCurrency(product.last_purchase_cost)
                  : "—"}
              </div>
            ) : null}
          </div>
          <span
            className={clsx(styles.stockBadge, out && styles.stockOut, low && styles.stockLow)}
          >
            {out ? t("pos.outOfStock", "Out") : stockText}
          </span>
        </div>
      </div>
    </div>
  );
});
