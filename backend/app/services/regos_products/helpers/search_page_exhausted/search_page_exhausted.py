def search_page_exhausted(
    *,
    collected_count: int,
    limit: int,
    last_page_result_count: int,
    regos_page_size: int,
) -> bool:
    return collected_count < limit and last_page_result_count < regos_page_size
