import { useEffect, useRef, useState } from "react";
import { Globe } from "lucide-react";
import clsx from "clsx";
import { useLanguage } from "@/contexts/LanguageContext";
import type { SupportedLanguage } from "@/services/language";
import styles from "./LanguageSelector.module.css";

const languageNameKeys: Record<SupportedLanguage, string> = {
  uz: "language.uz",
  ru: "language.ru",
  en: "language.en",
  tj: "language.tj",
};

const languageFlags: Record<SupportedLanguage, string> = {
  uz: "UZ",
  ru: "RU",
  en: "EN",
  tj: "TJ",
};

type LanguageSelectorProps = {
  className?: string;
  variant?: "icon" | "menu";
};

export function LanguageSelector({ className, variant = "icon" }: LanguageSelectorProps) {
  const { currentLanguage, changeLanguage, supportedLanguages, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleSelect = (lang: SupportedLanguage) => {
    void changeLanguage(lang);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        type="button"
        className={clsx(
          variant === "menu" ? styles.menuTrigger : styles.iconTrigger,
          className,
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("language.selectorLabel", "Language")}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {variant === "menu" ? (
          <>
            <Globe size={18} />
            <span>{t(languageNameKeys[currentLanguage])}</span>
          </>
        ) : (
          <>
            <span>{currentLanguage.toUpperCase()}</span>
            <Globe size={16} />
          </>
        )}
      </button>

      {open && (
        <div
          className={clsx(
            styles.menu,
            variant === "menu" ? styles.menuAbove : styles.menuBelow,
          )}
          role="menu"
        >
          {supportedLanguages.map((lang) => (
            <button
              key={lang}
              type="button"
              role="menuitem"
              className={clsx(
                styles.menuItem,
                currentLanguage === lang && styles.menuItemActive,
              )}
              onClick={(event) => {
                event.stopPropagation();
                handleSelect(lang);
              }}
            >
              <span className={styles.menuFlag}>{languageFlags[lang]}</span>
              {t(languageNameKeys[lang])}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
