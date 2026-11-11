const CACHE_ENABLED_KEY = "cache_enabled";

type CacheEnabledListener = () => void;

const listeners = new Set<CacheEnabledListener>();

function readStoredValue(): boolean {
  // Safari can throw SecurityError on *accessing* localStorage (even typeof),
  // so the entire probe must stay inside try/catch.
  try {
    const raw = localStorage.getItem(CACHE_ENABLED_KEY);
    if (raw === null) return false;
    return raw === "true";
  } catch {
    return false;
  }
}

let cachedValue = readStoredValue();

export function isCacheEnabled(): boolean {
  return cachedValue;
}

export function setCacheEnabled(enabled: boolean): void {
  const next = Boolean(enabled);
  if (cachedValue === next) return;

  try {
    localStorage.setItem(CACHE_ENABLED_KEY, next ? "true" : "false");
  } catch {
    // Keep in-memory toggle so the session can continue without persistence.
  }

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
