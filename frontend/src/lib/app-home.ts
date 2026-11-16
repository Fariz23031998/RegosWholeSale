/**
 * First useful in-app path for the signed-in user based on effective permissions.
 * Prefer Sell when allowed; otherwise Products for catalog-only roles.
 */
export function getAppHomePath(permissions: readonly string[] | undefined | null): string {
  const perms = permissions ?? [];
  if (perms.includes("pos.access")) return "/";
  if (perms.includes("stock.item_info") || perms.includes("labels.print")) return "/products";
  if (perms.includes("sales.read")) return "/sales";
  if (perms.includes("payments.read")) return "/payments";
  if (perms.includes("dashboard.read")) return "/dashboard";
  if (perms.includes("users.manage")) return "/users";
  if (perms.includes("settings.manage")) return "/settings";
  return "/docs";
}

export function canAccessSell(permissions: readonly string[] | undefined | null): boolean {
  return (permissions ?? []).includes("pos.access");
}
