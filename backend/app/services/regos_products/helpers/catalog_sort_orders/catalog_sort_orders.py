_CATALOG_SORT_COLUMNS = {
    "name": "Name",
    "articul": "Articul",
    "code": "Code",
    "brand.name": "brand.name",
    "unit.name": "unit.name",
    "department.name": "department.name",
}
_CATALOG_SORT_DIRECTIONS = {"asc": "ASC", "desc": "DESC"}

def catalog_sort_orders(
    sort_column: str | None = None,
    sort_direction: str | None = None,
) -> list[dict[str, str]]:
    column_key = (sort_column or "name").strip().lower()
    direction_key = (sort_direction or "asc").strip().lower()
    regos_column = _CATALOG_SORT_COLUMNS.get(column_key, "Name")
    regos_direction = _CATALOG_SORT_DIRECTIONS.get(direction_key, "ASC")
    return [{"column": regos_column, "direction": regos_direction}]
