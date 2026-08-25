import { SITE_THEME_COLOR } from "@/lib/site";

export const THEME_STORAGE_KEY = "regos-theme";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const THEME_PREFERENCES: ThemePreference[] = ["light", "dark", "system"];
const DARK_THEME_COLOR = "#1a1f2e";

type ThemeListener = () => void;

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";

  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") return getSystemTheme();
  return preference;
}

class ThemeService {
  private preference: ThemePreference = "system";
  private resolvedTheme: ResolvedTheme = "light";
  private listeners = new Set<ThemeListener>();
  private mediaQuery: MediaQueryList | null = null;
  private mediaListener: ((event: MediaQueryListEvent) => void) | null = null;
  private initialized = false;

  subscribe = (listener: ThemeListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private updateThemeColorMeta(resolved: ResolvedTheme): void {
    if (typeof document === "undefined") return;

    const color = resolved === "dark" ? DARK_THEME_COLOR : SITE_THEME_COLOR;
    let meta = document.querySelector('meta[name="theme-color"]');

    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }

    meta.setAttribute("content", color);
  }

  applyTheme(resolved: ResolvedTheme): void {
    if (typeof document === "undefined") return;

    document.documentElement.classList.toggle("dark", resolved === "dark");
    this.updateThemeColorMeta(resolved);
  }

  private bindSystemListener(): void {
    if (typeof window === "undefined") return;

    this.unbindSystemListener();
    this.mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    this.mediaListener = () => {
      if (this.preference !== "system") return;
      this.resolvedTheme = getSystemTheme();
      this.applyTheme(this.resolvedTheme);
      this.notify();
    };
    this.mediaQuery.addEventListener("change", this.mediaListener);
  }

  private unbindSystemListener(): void {
    if (this.mediaQuery && this.mediaListener) {
      this.mediaQuery.removeEventListener("change", this.mediaListener);
    }
    this.mediaQuery = null;
    this.mediaListener = null;
  }

  initialize(): void {
    if (this.initialized || typeof window === "undefined") return;

    this.initialized = true;
    this.preference = readStoredPreference();
    this.resolvedTheme = resolveTheme(this.preference);
    this.applyTheme(this.resolvedTheme);

    if (this.preference === "system") {
      this.bindSystemListener();
    }
  }

  getPreference(): ThemePreference {
    if (!this.initialized && typeof window !== "undefined") {
      this.preference = readStoredPreference();
    }
    return this.preference;
  }

  getResolvedTheme(): ResolvedTheme {
    if (!this.initialized && typeof window !== "undefined") {
      this.resolvedTheme = resolveTheme(readStoredPreference());
    }
    return this.resolvedTheme;
  }

  getPreferences(): ThemePreference[] {
    return THEME_PREFERENCES;
  }

  setPreference(preference: ThemePreference): void {
    if (preference === this.preference) return;

    this.preference = preference;
    this.resolvedTheme = resolveTheme(preference);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Ignore storage failures.
    }

    this.applyTheme(this.resolvedTheme);

    if (preference === "system") {
      this.bindSystemListener();
    } else {
      this.unbindSystemListener();
    }

    this.notify();
  }
}

export const themeService = new ThemeService();

export function getInitialResolvedTheme(): ResolvedTheme {
  const preference = readStoredPreference();
  return resolveTheme(preference);
}
