import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/contexts/LanguageContext";
import type { SupportedLanguage } from "@/services/language";

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
};

export function LanguageSelector({ className }: LanguageSelectorProps) {
  const { currentLanguage, changeLanguage, supportedLanguages, t } = useLanguage();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={className}
          variant="ghost"
          size="icon"
          aria-label={t("nav.settings", "Settings")}
        >
          <span>{currentLanguage.toUpperCase()}</span>
          <Globe className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {supportedLanguages.map((lang) => (
          <DropdownMenuItem
            key={lang}
            onClick={() => void changeLanguage(lang)}
            className={currentLanguage === lang ? "bg-accent" : ""}
          >
            <span className="mr-2">{languageFlags[lang]}</span>
            {t(languageNameKeys[lang])}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
