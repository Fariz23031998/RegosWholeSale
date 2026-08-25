def can_scan_more_regos(
    *,
    global_search: bool,
    collected_count: int,
    limit: int,
    result_count: int,
    regos_page_size: int,
    total: int,
    scan_cursor: int,
) -> bool:
    if collected_count >= limit or result_count <= 0:
        return False
    if result_count >= regos_page_size:
        return True
    if global_search:
        return False
    return total <= 0 or total > scan_cursor
