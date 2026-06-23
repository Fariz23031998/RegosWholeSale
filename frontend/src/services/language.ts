import { getApiBaseUrl } from "@/lib/api";
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

    await this.loadLanguage(langToUse);
    return langToUse;
  }

  async loadLanguage(langCode: SupportedLanguage): Promise<void> {
    try {
      const needsUpdate = await this.checkLanguageVersion(langCode);

      if (needsUpdate) {
        await this.fetchLanguageFromBackend(langCode);
      }

      const cachedTranslations = await getLanguage(langCode);

      if (cachedTranslations) {
        this.translations = cachedTranslations;
        this.currentLanguage = langCode;
        await saveLanguageSetting("current_language", langCode);
      } else {
        await this.fetchLanguageFromBackend(langCode);
      }
    } catch (error) {
      console.error("Error loading language:", error);
      this.translations = this.getFallbackTranslations();
      this.currentLanguage = "en";
    }
  }

  async checkLanguageVersion(langCode: SupportedLanguage): Promise<boolean> {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return false;

    try {
      const response = await fetch(`${apiBase}/lang/${langCode}/version`);

      if (!response.ok) return false;

      const data: LanguageVersion = await response.json();
      const cachedVersion = await getLanguageVersion(langCode);

      return !cachedVersion || cachedVersion !== data.version;
    } catch (error) {
      console.error("Error checking language version:", error);
      return false;
    }
  }

  async fetchLanguageFromBackend(langCode: SupportedLanguage): Promise<void> {
    const apiBase = getApiBaseUrl();
    if (!apiBase) {
      throw new Error("API URL not configured");
    }

    const response = await fetch(`${apiBase}/lang/${langCode}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) throw new Error("Failed to fetch language data");

    const data = (await response.json()) as LanguageApiResponse;

    await saveLanguage(langCode, data.version, data.translations);

    this.translations = data.translations;
    this.currentLanguage = langCode;
    await saveLanguageSetting("current_language", langCode);
  }

  t(key: string, fallback?: string): string {
    return this.translations[key] || fallback || key;
  }

  getCurrentLanguage(): SupportedLanguage {
    return this.currentLanguage;
  }

  getSupportedLanguages(): SupportedLanguage[] {
    return this.supportedLanguages;
  }

  async changeLanguage(langCode: SupportedLanguage): Promise<void> {
    await this.loadLanguage(langCode);
  }

  private getFallbackTranslations(): TranslationDictionary {
    return {
      "common.loading": "Loading...",
      "common.save": "Save",
      "common.cancel": "Cancel",
      "common.delete": "Delete",
      "common.edit": "Edit",
      "common.close": "Close",
      "common.confirm": "Confirm",
      "common.search": "Search",
      "common.add": "Add",
      "common.create": "Create",
      "common.error": "Error",
      "common.success": "Success",
      "common.tryAgain": "Try again",
      "common.goHome": "Go home",
      "nav.sell": "Sell",
      "nav.sales": "Sales",
      "nav.returns": "Returns",
      "nav.dashboard": "Dashboard",
      "nav.users": "Users",
      "nav.telegramUsers": "Telegram users",
      "nav.settings": "Settings",
      "nav.signOut": "Sign out",
      "nav.openMenu": "Open menu",
      "nav.closeMenu": "Close menu",
      "auth.title": "Regos Optom",
      "auth.signIn": "Sign in",
      "auth.signingIn": "Signing in…",
      "auth.signInSubtitle": "Sign in to your account",
      "auth.emailOrUsername": "Email or username",
      "auth.password": "Password",
      "auth.forgotPassword": "Forgot password?",
      "auth.newCompany": "New company?",
      "auth.createAccount": "Create account",
      "auth.passwordUpdated": "Password updated. You can sign in now.",
      "errors.pageNotFound": "Page not found",
      "errors.pageNotFoundDesc": "The page you're looking for doesn't exist or has been moved.",
      "errors.pageLoadFailed": "This page didn't load",
      "errors.pageLoadFailedDesc": "Something went wrong on our end. You can try refreshing or head back home.",
      "language.uz": "O'zbekcha",
      "language.ru": "Русский",
      "language.en": "English",
      "language.tj": "Тоҷикӣ",
    };
  }

  async clearCache(): Promise<void> {
    await clearLanguageData();
  }
}

export const languageService = new LanguageService();
