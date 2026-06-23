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

class LanguageService {
  private currentLanguage: SupportedLanguage = "en";
  private translations: TranslationDictionary = {};
  private supportedLanguages: SupportedLanguage[] = ["uz", "ru", "en", "tj"];

  detectBrowserLanguage(): SupportedLanguage {
    const browserLang = navigator.language || (navigator as Navigator & { userLanguage?: string }).userLanguage;
    const langCode = (browserLang ?? "en").split("-")[0].toLowerCase();

    if (this.supportedLanguages.includes(langCode as SupportedLanguage)) {
      return langCode as SupportedLanguage;
    }

    return "en";
  }

  async initialize(): Promise<SupportedLanguage> {
    const detectedLang = this.detectBrowserLanguage();
    const storedLang = await getLanguageSetting<SupportedLanguage>("current_language");
    const langToUse: SupportedLanguage = storedLang ?? detectedLang;

    try {
      await this.loadLanguage(langToUse);
    } catch (error) {
      console.error("Error loading language:", error);
      this.translations = this.getFallbackTranslations();
      this.currentLanguage = "en";
      await saveLanguageSetting("current_language", "en");
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

    this.translations = { ...cachedTranslations! };
    this.currentLanguage = langCode;
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

    this.translations = { ...data.translations };
    this.currentLanguage = langCode;
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
    await this.loadLanguage(langCode);
  }

  private getFallbackTranslations(): TranslationDictionary {
    return { ...FALLBACK_TRANSLATIONS };
  }

  async clearCache(): Promise<void> {
    await clearLanguageData();
  }
}

export const languageService = new LanguageService();
