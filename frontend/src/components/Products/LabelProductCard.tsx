import { useRef, type SyntheticEvent } from "react";
import clsx from "clsx";
import { Check, EllipsisVertical, History, Minus, Pencil, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatAmountWithCurrency } from "@/lib/checkout-payments";
import { formatCurrency } from "@/lib/format";
import { PRODUCT_FALLBACK_IMAGE } from "@/lib/product-image";
import { usePosConfig } from "@/store/pos-config";
import { useSellContext } from "@/store/sell-context";
import type { Product } from "@/types/catalog";
import posStyles from "@/components/POS/POS.module.css";
import styles from "./Products.module.css";

const MENU_TOGGLE_IGNORE_MS = 350;

type Props = {
  product: Product;
  selected: boolean;
  hideCardImages: boolean;
  onToggle: (product: Product) => void;
  showCopies?: boolean;
  copies?: number;
  onCopiesChange?: (product: Product, copies: number) => void;
  onCopiesKeypad?: (product: Product) => void;
  canEdit?: boolean;
  canViewHistory?: boolean;
  onEdit?: (product: Product) => void;
  onHistory?: (product: Product) => void;
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
  canEdit = false,
  canViewHistory = false,
  onEdit,
  onHistory,
}: Props) {
  const { t } = useLanguage();
  const saleCurrency = useSellContext((state) => state.saleCurrency);
  const showLastPurchaseCost = usePosConfig((state) => state.showLastPurchaseCost);
  const ignoreCardToggleUntilRef = useRef(0);
  const out = product.stock <= 0;
  const low = product.stock > 0 && product.stock < 10;
  const stockText = Number.isInteger(product.stock)
    ? t("pos.stockLeft", "{{n}} left", { n: product.stock })
    : t("pos.stockLeft", "{{n}} left", { n: product.stock.toFixed(2).replace(/\.?0+$/, "") });
  const showMenu = (canEdit && onEdit != null) || (canViewHistory && onHistory != null);
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

  const markMenuInteraction = () => {
    ignoreCardToggleUntilRef.current = Date.now() + MENU_TOGGLE_IGNORE_MS;
  };

  const shouldIgnoreCardToggle = () => Date.now() < ignoreCardToggleUntilRef.current;

  const stopCardToggle = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  const onMenuPointerDown = (event: SyntheticEvent) => {
    markMenuInteraction();
    stopCardToggle(event);
  };

  const menu = showMenu ? (
    <div
      className={styles.cardMenu}
      onPointerDown={onMenuPointerDown}
      onMouseDown={stopCardToggle}
      onClick={stopCardToggle}
      onKeyDown={stopCardToggle}
    >
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={styles.cardMenuBtn}
            aria-label={t("products.menu", "Product actions")}
            title={t("products.menu", "Product actions")}
            onPointerDown={onMenuPointerDown}
            onMouseDown={stopCardToggle}
            onClick={stopCardToggle}
          >
            <EllipsisVertical size={18} strokeWidth={2.5} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={4}
          className={styles.cardMenuContent}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {canEdit && onEdit ? (
            <DropdownMenuItem
              className={styles.cardMenuItem}
              onSelect={(event) => {
                event.preventDefault();
                markMenuInteraction();
                onEdit(product);
              }}
            >
              <Pencil size={16} />
              {t("stock.item.edit", "Edit product")}
            </DropdownMenuItem>
          ) : null}
          {canViewHistory && onHistory ? (
            <DropdownMenuItem
              className={styles.cardMenuItem}
              onSelect={(event) => {
                event.preventDefault();
                markMenuInteraction();
                onHistory(product);
              }}
            >
              <History size={16} />
              {t("products.history", "History")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
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
      onClick={(event) => {
        if (shouldIgnoreCardToggle()) return;
        if ((event.target as HTMLElement | null)?.closest?.(`.${styles.cardMenu}`)) {
          return;
        }
        onToggle(product);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          if (shouldIgnoreCardToggle()) return;
          if ((event.target as HTMLElement | null)?.closest?.(`.${styles.cardMenu}`)) {
            return;
          }
          event.preventDefault();
          onToggle(product);
        }
      }}
    >
      {menu}
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
          <div className={posStyles.cardPriceBlock}>
            <div className={posStyles.cardPrice}>
              {formatAmountWithCurrency(product.price, saleCurrency)}
            </div>
            {showLastPurchaseCost ? (
              <div className={posStyles.cardCost}>
                {t("stock.detail.table.cost", "Cost")}:{" "}
                {product.last_purchase_cost != null
                  ? formatCurrency(product.last_purchase_cost)
                  : "—"}
              </div>
            ) : null}
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
