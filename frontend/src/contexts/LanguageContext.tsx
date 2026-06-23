import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  languageService,
  type SupportedLanguage,
  type TranslationDictionary,
} from "@/services/language";

interface LanguageContextType {
  currentLanguage: SupportedLanguage;
  changeLanguage: (lang: SupportedLanguage) => Promise<void>;
  t: (key: string, fallback?: string, params?: Record<string, string | number>) => string;
  isLoading: boolean;
  supportedLanguages: SupportedLanguage[];
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

interface LanguageProviderProps {
  children: ReactNode;
}

export function LanguageProvider({ children }: LanguageProviderProps) {
  const [currentLanguage, setCurrentLanguage] = useState<SupportedLanguage>("en");
  const [isLoading, setIsLoading] = useState(true);
  const [translations, setTranslations] = useState<TranslationDictionary>({});

  useEffect(() => {
    const initializeLanguage = async () => {
      setIsLoading(true);
      try {
        const detectedLang = await languageService.initialize();
        setCurrentLanguage(detectedLang);
        setTranslations({ ...languageService.getTranslations() });
      } catch (error) {
        console.error("Failed to initialize language:", error);
      } finally {
        setIsLoading(false);
      }
    };

    void initializeLanguage();
  }, []);

  const changeLanguage = async (lang: SupportedLanguage) => {
    if (lang === currentLanguage) return;

    setIsLoading(true);
    try {
      await languageService.changeLanguage(lang);
      setCurrentLanguage(languageService.getCurrentLanguage());
      setTranslations({ ...languageService.getTranslations() });
    } catch (error) {
      console.error("Failed to change language:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const t = (key: string, fallback?: string, params?: Record<string, string | number>): string => {
    let translation = translations[key] || fallback || key;

    if (params) {
      Object.keys(params).forEach((param) => {
        const value = params[param].toString();
        translation = translation.replace(new RegExp(`\\{\\{?${param}\\}?\\}`, "g"), value);
      });
    }

    return translation;
  };

  const value: LanguageContextType = {
    currentLanguage,
    changeLanguage,
    t,
    isLoading,
    supportedLanguages: languageService.getSupportedLanguages(),
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextType {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
