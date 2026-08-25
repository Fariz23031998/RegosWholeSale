def next_regos_offset(
    current_offset: int,
    page_next_offset: int,
    result_count: int,
    regos_total: int,
) -> int:
    if page_next_offset > current_offset:
        return page_next_offset
    if result_count <= 0:
        return 0
    manual = current_offset + result_count
    if regos_total <= 0 or regos_total > manual:
        return manual
    return 0
