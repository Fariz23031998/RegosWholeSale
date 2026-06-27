import { memo, startTransition } from "react";
import clsx from "clsx";
import { Star } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { canAddProductToCart } from "@/lib/cart-stock";
import { formatAmountWithCurrency } from "@/lib/checkout-payments";
import { PRODUCT_FALLBACK_IMAGE } from "@/lib/product-image";
import { useCart } from "@/store/cart";
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
  onAdd: (product: Product) => void;
  onToggleFeatured: (product: Product) => void;
};

function productDisplayName(product: Product): string {
  const unitName = product.unit_name?.trim();
  if (!unitName) return product.name;
  return `${product.name} (${unitName})`;
}

function productCodeLine(product: Product): string {
  const parts = [product.code, product.articul, product.barcode]
    .map((value) => value?.trim())
    .filter(Boolean);
  if (parts.length > 0) return parts.join(" · ");
  return product.sku;
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
  onAdd,
  onToggleFeatured,
}: CatalogProductCardProps) {
  const { t } = useLanguage();
  const saleCurrency = useSellContext((state) => state.saleCurrency);
  const inCartQty = useCart(
    (state) => state.items.find((item) => item.productId === product.id)?.qty ?? 0,
  );

  const cannotAdd = !canAddProductToCart(
    product,
    inCartQty,
    allowOutOfStock,
    reservedInOtherTabs,
  );
  const out = product.stock <= 0;
  const low = product.stock > 0 && product.stock < 10;
  const stockText = Number.isInteger(product.stock)
    ? t("pos.stockLeft", "{{n}} left", { n: product.stock })
    : t("pos.stockLeft", "{{n}} left", {
        n: product.stock.toFixed(2).replace(/\.?0+$/, ""),
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
          <div className={styles.cardPrice}>
            {formatAmountWithCurrency(product.price, saleCurrency)}
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
