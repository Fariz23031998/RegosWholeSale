import type { Product, ProductGroup } from "@/types/catalog";

export function expandProductGroupIds(
  selectedIds: number[],
  groups: ProductGroup[],
): Set<number> | null {
  if (selectedIds.length === 0) return null;

  const childrenByParent = new Map<number, number[]>();
  for (const group of groups) {
    if (group.parent_id != null && group.parent_id > 0) {
      const siblings = childrenByParent.get(group.parent_id);
      if (siblings) siblings.push(group.id);
      else childrenByParent.set(group.parent_id, [group.id]);
    }
  }

  const expanded = new Set<number>();
  const stack = [...new Set(selectedIds.filter((id) => Number.isFinite(id) && id > 0))];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current == null || expanded.has(current)) continue;
    expanded.add(current);
    const children = childrenByParent.get(current);
    if (children) stack.push(...children);
  }
  return expanded;
}

export function filterProductGroups(
  groups: ProductGroup[],
  selectedIds: number[],
): ProductGroup[] {
  const expanded = expandProductGroupIds(selectedIds, groups);
  if (expanded == null) return groups;
  return groups.filter((group) => expanded.has(group.id));
}

export function isProductInScope(
  product: Pick<Product, "group_id">,
  expandedIds: Set<number> | null,
): boolean {
  if (expandedIds == null) return true;
  return product.group_id != null && expandedIds.has(product.group_id);
}

export function isPartnerInScope(
  partner: { group_id: number },
  allowedIds: number[],
): boolean {
  if (allowedIds.length === 0) return true;
  return allowedIds.includes(partner.group_id);
}

export function filterPartnersByAllowedGroups<T extends { group_id?: number | null }>(
  partners: T[],
  allowedIds: number[],
): T[] {
  if (allowedIds.length === 0) return partners;
  return partners.filter((partner) =>
    isPartnerInScope({ group_id: partner.group_id ?? 0 }, allowedIds),
  );
}

export function filterPartnerGroups<T extends { id: number }>(
  groups: T[],
  allowedIds: number[],
): T[] {
  if (allowedIds.length === 0) return groups;
  const allowed = new Set(allowedIds);
  return groups.filter((group) => allowed.has(group.id));
}

export function categoryPathDepth(path: string): number {
  const segments = path.split("/").map((segment) => segment.trim()).filter(Boolean);
  return Math.max(0, segments.length - 1);
}
