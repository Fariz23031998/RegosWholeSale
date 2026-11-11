export function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  const sign = rounded < 0 ? "-" : "";
  const [intPart, decPart = ""] = Math.abs(rounded).toFixed(2).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const fraction = decPart.replace(/0+$/, "");
  return fraction ? `${sign}${grouped}.${fraction}` : `${sign}${grouped}`;
}

export function formatDate(value: number | null): string {
  if (!value) return "";
  return new Date(value * 1000).toLocaleString();
}

export function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function partnerTokenKey(publicKey: string): string {
  return `partner-portal-token:${publicKey}`;
}

export function partnerCartKey(publicKey: string): string {
  return `partner-portal-cart:${publicKey}`;
}

export function partnerWarehouseKey(publicKey: string): string {
  return `partner-portal-warehouse:${publicKey}`;
}

/** JWT `exp` as epoch milliseconds, or null when the token cannot be read. */
export function partnerTokenExpiresAtMs(token: string): number | null {
  try {
    const segment = token.split(".")[1];
    if (!segment) return null;
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const json = JSON.parse(atob(`${padded}${pad}`)) as { exp?: unknown };
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function isPartnerTokenExpired(token: string, nowMs = Date.now()): boolean {
  const expiresAt = partnerTokenExpiresAtMs(token);
  if (expiresAt == null) return true;
  return expiresAt <= nowMs;
}

function canUseStorage(storage: Storage | undefined): storage is Storage {
  return typeof storage !== "undefined";
}

/** Persist across browser restarts; honor JWT expiry from PARTNER_ACCESS_TOKEN_EXPIRE_HOURS. */
export function readPartnerToken(publicKey: string, nowMs = Date.now()): string | null {
  const key = partnerTokenKey(publicKey);
  const local = canUseStorage(globalThis.localStorage) ? localStorage.getItem(key) : null;
  const session = canUseStorage(globalThis.sessionStorage) ? sessionStorage.getItem(key) : null;
  const token = local || session;
  if (!token) return null;
  if (isPartnerTokenExpired(token, nowMs)) {
    clearPartnerToken(publicKey);
    return null;
  }
  if (!local && session && canUseStorage(globalThis.localStorage)) {
    localStorage.setItem(key, session);
    sessionStorage.removeItem(key);
  }
  return token;
}

export function writePartnerToken(publicKey: string, token: string): void {
  const key = partnerTokenKey(publicKey);
  if (canUseStorage(globalThis.localStorage)) {
    localStorage.setItem(key, token);
  }
  if (canUseStorage(globalThis.sessionStorage)) {
    sessionStorage.removeItem(key);
  }
}

export function clearPartnerToken(publicKey: string): void {
  const key = partnerTokenKey(publicKey);
  if (canUseStorage(globalThis.localStorage)) {
    localStorage.removeItem(key);
  }
  if (canUseStorage(globalThis.sessionStorage)) {
    sessionStorage.removeItem(key);
  }
}
