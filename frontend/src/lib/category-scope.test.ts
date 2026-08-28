import { describe, expect, it } from "vitest";
import type { ProductGroup } from "@/types/catalog";
import {
  expandProductGroupIds,
  filterPartnerGroups,
  filterProductGroups,
  filterPartnersByAllowedGroups,
  isPartnerInScope,
  isProductInScope,
} from "./category-scope";

const groups: ProductGroup[] = [
  { id: 1, parent_id: null, name: "Food", path: "Food", child_count: 1 },
  { id: 2, parent_id: 1, name: "Dairy", path: "Food / Dairy", child_count: 1 },
  { id: 3, parent_id: 2, name: "Milk", path: "Food / Dairy / Milk", child_count: 0 },
  { id: 4, parent_id: null, name: "Tools", path: "Tools", child_count: 0 },
];

describe("category-scope", () => {
  it("expands parent product groups to include descendants", () => {
    expect(expandProductGroupIds([], groups)).toBeNull();
    expect(expandProductGroupIds([1], groups)).toEqual(new Set([1, 2, 3]));
    expect(expandProductGroupIds([2], groups)).toEqual(new Set([2, 3]));
  });

  it("filters product groups to the expanded allowlist", () => {
    expect(filterProductGroups(groups, []).map((g) => g.id)).toEqual([1, 2, 3, 4]);
    expect(filterProductGroups(groups, [1]).map((g) => g.id)).toEqual([1, 2, 3]);
    expect(filterProductGroups(groups, [4]).map((g) => g.id)).toEqual([4]);
  });

  it("checks product and partner membership", () => {
    const expanded = expandProductGroupIds([1], groups);
    expect(isProductInScope({ group_id: 3 }, expanded)).toBe(true);
    expect(isProductInScope({ group_id: 4 }, expanded)).toBe(false);
    expect(isProductInScope({ group_id: 4 }, null)).toBe(true);
    expect(isPartnerInScope({ group_id: 9 }, [])).toBe(true);
    expect(isPartnerInScope({ group_id: 9 }, [9, 2])).toBe(true);
    expect(isPartnerInScope({ group_id: 1 }, [9, 2])).toBe(false);
    expect(filterPartnerGroups([{ id: 1 }, { id: 2 }], [2]).map((g) => g.id)).toEqual([2]);
  });

  it("filters partners by allowed groups", () => {
    const partners = [
      { id: 1, group_id: 9 },
      { id: 2, group_id: 2 },
      { id: 3, group_id: 1 },
    ];
    expect(filterPartnersByAllowedGroups(partners, []).map((p) => p.id)).toEqual([1, 2, 3]);
    expect(filterPartnersByAllowedGroups(partners, [9, 2]).map((p) => p.id)).toEqual([1, 2]);
    expect(filterPartnersByAllowedGroups(partners, [4]).map((p) => p.id)).toEqual([]);
  });
});
