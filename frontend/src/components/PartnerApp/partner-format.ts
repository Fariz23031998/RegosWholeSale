export function formatAmount(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
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
