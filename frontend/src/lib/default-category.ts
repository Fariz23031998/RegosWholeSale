export type DefaultCategoryMode = "all" | "featured" | "group";

export type DefaultCategory = {
  mode: DefaultCategoryMode;
  group_id: number | null;
};

export const DEFAULT_CATEGORY_ALL: DefaultCategory = { mode: "all", group_id: null };

export function defaultCategoryToSelectValue(category: DefaultCategory): string {
  if (category.mode === "featured") return "featured";
  if (category.mode === "group" && category.group_id) return `group:${category.group_id}`;
  return "all";
}

export function selectValueToDefaultCategory(value: string): DefaultCategory {
  if (value === "featured") return { mode: "featured", group_id: null };
  if (value.startsWith("group:")) {
    const groupId = Number.parseInt(value.slice(6), 10);
    if (Number.isFinite(groupId) && groupId > 0) {
      return { mode: "group", group_id: groupId };
    }
  }
  return DEFAULT_CATEGORY_ALL;
}

export function applyDefaultCategory(category: DefaultCategory): {
  featuredOnly: boolean;
  selectedGroupId: number | null;
} {
  if (category.mode === "featured") {
    return { featuredOnly: true, selectedGroupId: null };
  }
  if (category.mode === "group" && category.group_id) {
    return { featuredOnly: false, selectedGroupId: category.group_id };
  }
  return { featuredOnly: false, selectedGroupId: null };
}
