from app.services.regos_products.helpers.search_page_exhausted.search_page_exhausted import search_page_exhausted

def client_list_total(
    *,
    global_search: bool,
    client_offset: int,
    collected_count: int,
    regos_total: int,
    last_page_result_count: int,
    regos_page_size: int,
    limit: int,
) -> int:
    if global_search and search_page_exhausted(
        collected_count=collected_count,
        limit=limit,
        last_page_result_count=last_page_result_count,
        regos_page_size=regos_page_size,
    ):
        return client_offset + collected_count
    if regos_total > 0 and not global_search:
        return regos_total
    return regos_total or client_offset + collected_count
