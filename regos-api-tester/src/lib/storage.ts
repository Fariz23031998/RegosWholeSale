export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / private mode errors
  }
}

export const STORAGE_KEYS = {
  apiRequest: "regos-api-tester:api-request",
  oauth: "regos-api-tester:oauth",
  webhook: "regos-api-tester:webhook",
  webhookHistory: "regos-api-tester:webhook-history",
  useProxy: "regos-api-tester:use-proxy",
  activeTab: "regos-api-tester:active-tab",
} as const;
