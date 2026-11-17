import { SlidersHorizontal } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  PRODUCT_ITEM_OPTIONAL_FIELD_KEYS,
  type ProductItemOptionalFieldKey,
} from "@/lib/product-item-form-db";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import styles from "./StockDocs.module.css";

const FIELD_LABEL_KEYS: Record<
  ProductItemOptionalFieldKey,
  { key: string; fallback: string }
> = {
  vat: { key: "stock.item.fields.vat", fallback: "VAT" },
  secondary_unit: {
    key: "stock.item.fields.secondaryUnit",
    fallback: "Secondary unit (optional)",
  },
  image: { key: "stock.item.fields.image", fallback: "Image" },
  articul: { key: "stock.item.fields.articul", fallback: "SKU" },
  barcodes: { key: "stock.item.fields.barcode", fallback: "Barcode" },
  icps: { key: "stock.item.fields.icps", fallback: "IKPU" },
  package_code: { key: "stock.item.fields.packageCode", fallback: "Package code" },
  is_labeled: { key: "stock.item.fields.isLabeled", fallback: "Subject to labeling" },
  description: { key: "common.description", fallback: "Description" },
};

type Props = {
  visible: Record<ProductItemOptionalFieldKey, boolean>;
  onChange: (key: ProductItemOptionalFieldKey, visible: boolean) => void;
};

export function ItemFormOptionalFieldsMenu({ visible, onChange }: Props) {
  const { t } = useLanguage();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={styles.itemFormFieldsMenuButton}
          aria-label={t("stock.item.fieldsVisibility", "Optional fields")}
          title={t("stock.item.fieldsVisibility", "Optional fields")}
        >
          <SlidersHorizontal size={16} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={4}
        className={styles.itemFormFieldsMenuContent}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuLabel className={styles.itemFormFieldsMenuLabel}>
          {t("stock.item.fieldsVisibility", "Optional fields")}
        </DropdownMenuLabel>
        {PRODUCT_ITEM_OPTIONAL_FIELD_KEYS.map((key) => {
          const label = FIELD_LABEL_KEYS[key];
          return (
            <DropdownMenuCheckboxItem
              key={key}
              className={styles.itemFormFieldsMenuItem}
              checked={visible[key]}
              onCheckedChange={(checked) => onChange(key, checked === true)}
              onSelect={(event) => event.preventDefault()}
            >
              {t(label.key, label.fallback)}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
