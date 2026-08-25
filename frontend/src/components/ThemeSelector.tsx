import { startTransition, useEffect, useRef, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import clsx from "clsx";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { ThemePreference } from "@/services/theme";
import styles from "./ThemeSelector.module.css";

const themeNameKeys: Record<ThemePreference, string> = {
  light: "theme.light",
  dark: "theme.dark",
  system: "theme.system",
};

const themeIcons: Record<ThemePreference, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

type ThemeSelectorProps = {
  className?: string;
  variant?: "menu" | "segmented";
};

export function ThemeSelector({ className, variant = "menu" }: ThemeSelectorProps) {
  const { preference, setPreference, options } = useTheme();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const CurrentIcon = themeIcons[preference];

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

  const handleSelect = (next: ThemePreference) => {
    setOpen(false);
    startTransition(() => {
      setPreference(next);
    });
  };

  if (variant === "segmented") {
    return (
      <div className={clsx(styles.segmented, className)} role="group" aria-label={t("theme.selectorLabel", "Appearance")}>
        {options.map((option) => {
          const Icon = themeIcons[option];
          return (
            <button
              key={option}
              type="button"
              className={clsx(
                styles.segmentBtn,
                preference === option && styles.segmentBtnActive,
              )}
              aria-pressed={preference === option}
              onClick={() => handleSelect(option)}
            >
              <Icon size={16} />
              {t(themeNameKeys[option])}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        type="button"
        className={clsx(styles.menuTrigger, className)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("theme.selectorLabel", "Appearance")}
        onClick={(event) => {
          event.stopPropagation();
          startTransition(() => {
            setOpen((value) => !value);
          });
        }}
      >
        <CurrentIcon size={18} />
        <span>{t(themeNameKeys[preference])}</span>
      </button>

      {open && (
        <div className={clsx(styles.menu, styles.menuAbove)} role="menu">
          {options.map((option) => {
            const Icon = themeIcons[option];
            return (
              <button
                key={option}
                type="button"
                role="menuitem"
                className={clsx(
                  styles.menuItem,
                  preference === option && styles.menuItemActive,
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  handleSelect(option);
                }}
              >
                <Icon size={16} />
                {t(themeNameKeys[option])}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
