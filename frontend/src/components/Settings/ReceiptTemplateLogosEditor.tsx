import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  MAX_RECEIPT_TEMPLATE_LOGOS,
  readReceiptLogoFile,
  RECEIPT_LOGO_ACCEPT,
} from "@/lib/receipt-template-logos";
import type { ReceiptTemplateLogo } from "@/types/receipt-templates";
import styles from "./ReceiptTemplates.module.css";

type Props = {
  logos: ReceiptTemplateLogo[];
  onChange: (logos: ReceiptTemplateLogo[]) => void;
  onError?: (message: string) => void;
};

export function ReceiptTemplateLogosEditor({ logos, onChange, onError }: Props) {
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const updateLogo = (id: string, patch: Partial<ReceiptTemplateLogo>) => {
    onChange(
      logos.map((logo) => (logo.id === id ? { ...logo, ...patch } : logo)),
    );
  };

  const removeLogo = (id: string) => {
    onChange(logos.filter((logo) => logo.id !== id));
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    if (logos.length >= MAX_RECEIPT_TEMPLATE_LOGOS) {
      onError?.(
        t(
          "settings.receiptTemplates.logos.maxCount",
          "A template can have at most {{count}} logos.",
          { count: MAX_RECEIPT_TEMPLATE_LOGOS },
        ),
      );
      return;
    }

    setUploading(true);
    try {
      const next = [...logos];
      for (const file of Array.from(files)) {
        if (next.length >= MAX_RECEIPT_TEMPLATE_LOGOS) break;
        const logo = await readReceiptLogoFile(file);
        next.push(logo);
      }
      onChange(next);
    } catch (err: unknown) {
      onError?.(err instanceof Error ? err.message : "Failed to add logo.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className={styles.logoSettings}>
      <div className={styles.label}>
        {t("settings.receiptTemplates.logos.title", "Logos")}
      </div>
      <p className={styles.sortHelp}>
        {t(
          "settings.receiptTemplates.logos.help",
          "Upload one or more images for the receipt header. In HTML templates use {{logoImg \"Name\"}} or {{#each logos}}.",
        )}
      </p>

      {logos.length > 0 ? (
        <div className={styles.logoList}>
          {logos.map((logo) => (
            <div key={logo.id} className={styles.logoRowEditor}>
              <img className={styles.logoPreview} src={logo.src} alt={logo.name} />
              <div className={styles.logoFields}>
                <label className={styles.field}>
                  <span className={styles.label}>
                    {t("settings.receiptTemplates.logos.name", "Logo name")}
                  </span>
                  <input
                    className={styles.input}
                    value={logo.name}
                    onChange={(e) => updateLogo(logo.id, { name: e.target.value })}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>
                    {t("settings.receiptTemplates.logos.maxWidth", "Max width (px)")}
                  </span>
                  <input
                    className={styles.input}
                    type="number"
                    min={1}
                    max={600}
                    value={logo.max_width ?? ""}
                    placeholder={t("settings.receiptTemplates.logos.auto", "Auto")}
                    onChange={(e) => {
                      const value = e.target.value.trim();
                      updateLogo(logo.id, {
                        max_width: value ? Number(value) : null,
                      });
                    }}
                  />
                </label>
              </div>
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.logoRemoveBtn}`}
                onClick={() => removeLogo(logo.id)}
                aria-label={t("settings.receiptTemplates.logos.remove", "Remove logo")}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <input
          ref={fileInputRef}
          type="file"
          accept={RECEIPT_LOGO_ACCEPT}
          multiple
          className={styles.hiddenFileInput}
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <button
          type="button"
          className={styles.actionBtn}
          disabled={uploading || logos.length >= MAX_RECEIPT_TEMPLATE_LOGOS}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading
            ? t("settings.receiptTemplates.logos.uploading", "Uploading…")
            : t("settings.receiptTemplates.logos.add", "Add logo")}
        </button>
      </div>
    </div>
  );
}
