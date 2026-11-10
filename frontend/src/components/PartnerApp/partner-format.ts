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
