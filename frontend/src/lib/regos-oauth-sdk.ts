export type RegosOAuthLanguage = "ru" | "en" | "uz";

export type RegosOAuthSdkUser = {
  sub?: string;
  email?: string;
  phone_number?: string;
  given_name?: string;
  family_name?: string;
  company?: string;
  [key: string]: unknown;
};

export type RegosOAuthSdkOptions = {
  clientId: string;
  redirectUri: string;
  containerId?: string;
  language?: RegosOAuthLanguage;
  buttonSize?: "s" | "m" | "l";
  buttonTheme?: "light" | "dark";
  buttonType?: "text" | "icon-text" | "icon";
  buttonTextType?: "full" | "short";
  buttonBorderRadius?: number;
  flow?: "auto" | "redirect";
  silent?: boolean;
  debug?: boolean;
  onData?: (user: RegosOAuthSdkUser | null, accessToken: string | null) => void;
  onLogout?: () => void;
  onError?: (error: { message?: string } | Error) => void;
};

type RegosOAuthSdkApi = {
  initialize: (options: RegosOAuthSdkOptions) => void;
};

declare global {
  interface Window {
    RegosOAuthSDK?: RegosOAuthSdkApi;
  }
}

const SDK_SRC = "https://auth.regos.uz/widget/regos-oauth-sdk.js";

let loadPromise: Promise<RegosOAuthSdkApi> | null = null;

export function loadRegosOAuthSdk(): Promise<RegosOAuthSdkApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("RegosOAuthSDK requires a browser"));
  }
  if (window.RegosOAuthSDK) {
    return Promise.resolve(window.RegosOAuthSDK);
  }
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = new Promise<RegosOAuthSdkApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SDK_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.RegosOAuthSDK) resolve(window.RegosOAuthSDK);
        else reject(new Error("RegosOAuthSDK failed to initialize"));
      });
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load RegosOAuthSDK")),
      );
      return;
    }

    const script = document.createElement("script");
    script.src = SDK_SRC;
    script.async = true;
    script.onload = () => {
      if (window.RegosOAuthSDK) resolve(window.RegosOAuthSDK);
      else reject(new Error("RegosOAuthSDK failed to initialize"));
    };
    script.onerror = () => reject(new Error("Failed to load RegosOAuthSDK"));
    document.head.appendChild(script);
  }).catch((error) => {
    loadPromise = null;
    throw error;
  });

  return loadPromise;
}

export function mapAppLanguageToRegos(language: string | undefined | null): RegosOAuthLanguage {
  const normalized = (language || "en").toLowerCase();
  if (normalized.startsWith("ru")) return "ru";
  if (normalized.startsWith("uz")) return "uz";
  return "en";
}
