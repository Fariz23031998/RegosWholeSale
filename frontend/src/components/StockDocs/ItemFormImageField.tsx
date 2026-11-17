import { useRef } from "react";
import { ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  readItemImageFile,
  type ItemImageFilePayload,
} from "@/lib/item-image-file";
import { hasProductImage, PRODUCT_FALLBACK_IMAGE } from "@/lib/product-image";
import styles from "./StockDocs.module.css";

type Props = {
  existingImageUrl?: string | null;
  pending: ItemImageFilePayload | null;
  disabled?: boolean;
  onPendingChange: (next: ItemImageFilePayload | null) => void;
};

export function ItemFormImageField({
  existingImageUrl,
  pending,
  disabled = false,
  onPendingChange,
}: Props) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const previewSrc = pending?.previewUrl
    || (hasProductImage(existingImageUrl) ? existingImageUrl!.trim() : "");
  const showPreview = Boolean(previewSrc);

  const handlePick = async (file: File | null) => {
    if (!file) return;
    try {
      const payload = await readItemImageFile(file);
      onPendingChange(payload);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : t("stock.item.errors.imageRead", "Failed to read image file");
      toast.error(message);
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className={styles.formField}>
      <label>{t("stock.item.fields.image", "Image")}</label>
      <div className={styles.itemImageField}>
        <div className={styles.itemImagePreview}>
          <img
            src={showPreview ? previewSrc : PRODUCT_FALLBACK_IMAGE}
            alt=""
            className={styles.itemImagePreviewImg}
          />
        </div>
        <div className={styles.itemImageActions}>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
            className={styles.itemImageFileInput}
            disabled={disabled}
            onChange={(e) => void handlePick(e.target.files?.[0] ?? null)}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus size={16} />
            {pending
              ? t("stock.item.image.change", "Change image")
              : t("stock.item.image.choose", "Choose image")}
          </Button>
          {pending ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label={t("stock.item.image.clear", "Clear selected image")}
              title={t("stock.item.image.clear", "Clear selected image")}
              onClick={() => onPendingChange(null)}
            >
              <X size={16} />
            </Button>
          ) : null}
          {pending?.fileName ? (
            <div className={styles.fieldHint}>{pending.fileName}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
