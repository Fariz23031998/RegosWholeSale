from app.services.regos_products.helpers.search_page_exhausted.search_page_exhausted import search_page_exhausted

def client_next_offset(
    *,
    total: int,
    scan_cursor: int,
    last_page_result_count: int,
    regos_page_size: int,
    collected_count: int,
    limit: int,
    global_search: bool = False,
) -> int:
    if last_page_result_count <= 0:
        return 0
    if global_search and search_page_exhausted(
        collected_count=collected_count,
        limit=limit,
        last_page_result_count=last_page_result_count,
        regos_page_size=regos_page_size,
    ):
        return 0
    if total > 0:
        return scan_cursor if total > scan_cursor else 0
    if collected_count < limit:
        return scan_cursor
    if last_page_result_count >= regos_page_size:
        return scan_cursor
    return 0
