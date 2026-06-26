import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  languageService,
  type SupportedLanguage,
} from "@/services/language";

interface LanguageProviderProps {
  children: ReactNode;
}

function subscribe(onStoreChange: () => void) {
  return languageService.subscribe(onStoreChange);
}

function getLanguageSnapshot(): SupportedLanguage {
  return languageService.getCurrentLanguage();
}

function getLanguageServerSnapshot(): SupportedLanguage {
  return "en";
}

function getLoadingSnapshot(): boolean {
  return languageService.getIsLoading();
}

function getLoadingServerSnapshot(): boolean {
  return true;
}

export function LanguageProvider({ children }: LanguageProviderProps) {
  useEffect(() => {
    void languageService.initialize();
  }, []);

  return <>{children}</>;
}

export function useLanguage() {
  const currentLanguage = useSyncExternalStore(
    subscribe,
    getLanguageSnapshot,
    getLanguageServerSnapshot,
  );
  const isLoading = useSyncExternalStore(
    subscribe,
    getLoadingSnapshot,
    getLoadingServerSnapshot,
  );

  const changeLanguage = useCallback(async (lang: SupportedLanguage) => {
    try {
      await languageService.changeLanguage(lang);
    } catch (error) {
      console.error("Failed to change language:", error);
    }
  }, []);

  const t = useCallback(
    (key: string, fallback?: string, params?: Record<string, string | number>): string => {
      let translation = languageService.t(key, fallback);

      if (params) {
        for (const [param, value] of Object.entries(params)) {
          translation = translation.replace(
            new RegExp(`\\{\\{?${param}\\}?\\}`, "g"),
            String(value),
          );
        }
      }

      return translation;
    },
    [currentLanguage],
  );

  return useMemo(
    () => ({
      currentLanguage,
      changeLanguage,
      t,
      isLoading,
      supportedLanguages: languageService.getSupportedLanguages(),
    }),
    [changeLanguage, currentLanguage, isLoading, t],
  );
}
