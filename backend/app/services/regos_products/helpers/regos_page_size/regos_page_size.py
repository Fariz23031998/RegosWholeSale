def regos_page_size(client_limit: int) -> int:
    return max(client_limit, 60)
