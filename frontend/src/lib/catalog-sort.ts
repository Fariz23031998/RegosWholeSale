export type CatalogSortColumn = "name" | "articul" | "code";
export type CatalogSortDirection = "asc" | "desc";

export type CatalogSort = {
  column: CatalogSortColumn;
  direction: CatalogSortDirection;
};

export const DEFAULT_CATALOG_SORT: CatalogSort = {
  column: "name",
  direction: "asc",
};

export type CatalogSortOptionId =
  | "name_asc"
  | "name_desc"
  | "articul_asc"
  | "articul_desc"
  | "code_asc"
  | "code_desc";

export const CATALOG_SORT_OPTIONS: Array<{
  id: CatalogSortOptionId;
  column: CatalogSortColumn;
  direction: CatalogSortDirection;
  labelKey: string;
  fallback: string;
}> = [
  { id: "name_asc", column: "name", direction: "asc", labelKey: "pos.sort.nameAsc", fallback: "Name A–Z" },
  { id: "name_desc", column: "name", direction: "desc", labelKey: "pos.sort.nameDesc", fallback: "Name Z–A" },
  {
    id: "articul_asc",
    column: "articul",
    direction: "asc",
    labelKey: "pos.sort.articulAsc",
    fallback: "SKU A–Z",
  },
  {
    id: "articul_desc",
    column: "articul",
    direction: "desc",
    labelKey: "pos.sort.articulDesc",
    fallback: "SKU Z–A",
  },
  { id: "code_asc", column: "code", direction: "asc", labelKey: "pos.sort.codeAsc", fallback: "Code A–Z" },
  { id: "code_desc", column: "code", direction: "desc", labelKey: "pos.sort.codeDesc", fallback: "Code Z–A" },
];

export function catalogSortToOptionId(sort: CatalogSort): CatalogSortOptionId {
  return `${sort.column}_${sort.direction}` as CatalogSortOptionId;
}

export function catalogSortFromOptionId(optionId: string): CatalogSort {
  const match = CATALOG_SORT_OPTIONS.find((option) => option.id === optionId);
  return match
    ? { column: match.column, direction: match.direction }
    : { ...DEFAULT_CATALOG_SORT };
}

export function normalizeCatalogSort(value: unknown): CatalogSort {
  if (!value || typeof value !== "object") return { ...DEFAULT_CATALOG_SORT };

  const record = value as Partial<CatalogSort>;
  const column = record.column;
  const direction = record.direction;
  const validColumn =
    column === "name" || column === "articul" || column === "code"
      ? column
      : DEFAULT_CATALOG_SORT.column;
  const validDirection =
    direction === "asc" || direction === "desc" ? direction : DEFAULT_CATALOG_SORT.direction;

  return { column: validColumn, direction: validDirection };
}
