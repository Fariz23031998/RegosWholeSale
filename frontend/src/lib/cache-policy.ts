const CACHE_ENABLED_KEY = "cache_enabled";

type CacheEnabledListener = () => void;

const listeners = new Set<CacheEnabledListener>();

function readStoredValue(): boolean {
  if (typeof localStorage === "undefined") return true;
  const raw = localStorage.getItem(CACHE_ENABLED_KEY);
  if (raw === null) return true;
  return raw === "true";
}

let cachedValue = readStoredValue();

export function isCacheEnabled(): boolean {
  return cachedValue;
}

export function setCacheEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;

  const next = Boolean(enabled);
  if (cachedValue === next) return;

  localStorage.setItem(CACHE_ENABLED_KEY, next ? "true" : "false");
  cachedValue = next;

  for (const listener of listeners) {
    listener();
  }
}

export function subscribeCacheEnabled(listener: CacheEnabledListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** @internal Resets in-memory state for tests. */
export function resetCachePolicyForTests(): void {
  cachedValue = readStoredValue();
  listeners.clear();
}
