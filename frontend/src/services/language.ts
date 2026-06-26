import { apiRequest } from "@/lib/api";
import { FALLBACK_TRANSLATIONS } from "@/lib/fallback-translations";
import {
  clearLanguageData,
  getLanguage,
  getLanguageSetting,
  getLanguageVersion,
  saveLanguage,
  saveLanguageSetting,
} from "@/lib/language-db";

export type SupportedLanguage = "uz" | "ru" | "en" | "tj";

export interface LanguageVersion {
  version: string;
  last_updated: string;
}

export interface TranslationDictionary {
  [key: string]: string;
}

interface LanguageApiResponse {
  version: string;
  last_updated: string;
  translations: TranslationDictionary;
}

type LanguageListener = () => void;

class LanguageService {
  private currentLanguage: SupportedLanguage = "en";
  private translations: TranslationDictionary = {};
  private supportedLanguages: SupportedLanguage[] = ["uz", "ru", "en", "tj"];
  private listeners = new Set<LanguageListener>();
  private loading = true;
  private notifyFrame: number | null = null;

  subscribe = (listener: LanguageListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getIsLoading(): boolean {
    return this.loading;
  }

  private setLoading(loading: boolean): void {
    if (this.loading === loading) return;
    this.loading = loading;
    this.scheduleNotify();
  }

  private scheduleNotify(): void {
    if (typeof window === "undefined") {
      this.emitNotify();
      return;
    }

    if (this.notifyFrame !== null) return;
    this.notifyFrame = window.requestAnimationFrame(() => {
      this.notifyFrame = null;
      this.emitNotify();
    });
  }

  private emitNotify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private applyLanguage(langCode: SupportedLanguage, translations: TranslationDictionary): void {
    this.translations = translations;
    this.currentLanguage = langCode;
    this.scheduleNotify();
  }

  detectBrowserLanguage(): SupportedLanguage {
    const browserLang = navigator.language || (navigator as Navigator & { userLanguage?: string }).userLanguage;
    const langCode = (browserLang ?? "en").split("-")[0].toLowerCase();

    if (this.supportedLanguages.includes(langCode as SupportedLanguage)) {
      return langCode as SupportedLanguage;
    }

    return "en";
  }

  async initialize(): Promise<SupportedLanguage> {
    this.setLoading(true);
    const detectedLang = this.detectBrowserLanguage();
    const storedLang = await getLanguageSetting<SupportedLanguage>("current_language");
    const langToUse: SupportedLanguage = storedLang ?? detectedLang;

    try {
      await this.loadLanguage(langToUse);
    } catch (error) {
      console.error("Error loading language:", error);
      this.applyLanguage("en", this.getFallbackTranslations());
      await saveLanguageSetting("current_language", "en");
    } finally {
      this.setLoading(false);
    }

    return this.currentLanguage;
  }

  async loadLanguage(langCode: SupportedLanguage): Promise<void> {
    const cachedTranslations = await getLanguage(langCode);
    let needsFetch = !cachedTranslations;

    if (cachedTranslations) {
      try {
        needsFetch = await this.checkLanguageVersion(langCode);
      } catch (error) {
        console.error("Error checking language version:", error);
        needsFetch = false;
      }
    }

    if (needsFetch) {
      await this.fetchLanguageFromBackend(langCode);
      return;
    }

    this.applyLanguage(langCode, cachedTranslations!);
    await saveLanguageSetting("current_language", langCode);
  }

  async checkLanguageVersion(langCode: SupportedLanguage): Promise<boolean> {
    const data = await apiRequest<LanguageVersion>(`/api/v1/lang/${langCode}/version`);
    const cachedVersion = await getLanguageVersion(langCode);

    return !cachedVersion || cachedVersion !== data.version;
  }

  async fetchLanguageFromBackend(langCode: SupportedLanguage): Promise<void> {
    const data = await apiRequest<LanguageApiResponse>(`/api/v1/lang/${langCode}`);

    await saveLanguage(langCode, data.version, data.translations);

    this.applyLanguage(langCode, data.translations);
    await saveLanguageSetting("current_language", langCode);
  }

  t(key: string, fallback?: string): string {
    return this.translations[key] || fallback || key;
  }

  getCurrentLanguage(): SupportedLanguage {
    return this.currentLanguage;
  }

  getTranslations(): TranslationDictionary {
    return this.translations;
  }

  getSupportedLanguages(): SupportedLanguage[] {
    return this.supportedLanguages;
  }

  async changeLanguage(langCode: SupportedLanguage): Promise<void> {
    if (langCode === this.currentLanguage) return;
    await this.loadLanguage(langCode);
  }

  private getFallbackTranslations(): TranslationDictionary {
    return FALLBACK_TRANSLATIONS;
  }

  async clearCache(): Promise<void> {
    await clearLanguageData();
  }
}

export const languageService = new LanguageService();
