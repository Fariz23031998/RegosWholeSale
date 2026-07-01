from fastapi import HTTPException, status


class AppError(HTTPException):
    def __init__(self, status_code: int, detail: str, code: str) -> None:
        super().__init__(status_code=status_code, detail={"detail": detail, "code": code})
        self.code = code


def bad_request(detail: str, code: str = "BAD_REQUEST") -> AppError:
    return AppError(status.HTTP_400_BAD_REQUEST, detail, code)


def unauthorized(detail: str = "Invalid credentials", code: str = "INVALID_CREDENTIALS") -> AppError:
    return AppError(status.HTTP_401_UNAUTHORIZED, detail, code)


def forbidden(detail: str = "Forbidden", code: str = "FORBIDDEN") -> AppError:
    return AppError(status.HTTP_403_FORBIDDEN, detail, code)


def not_found(detail: str = "Not found", code: str = "NOT_FOUND") -> AppError:
    return AppError(status.HTTP_404_NOT_FOUND, detail, code)


def conflict(detail: str, code: str = "CONFLICT") -> AppError:
    return AppError(status.HTTP_409_CONFLICT, detail, code)


def gone(detail: str, code: str = "GONE") -> AppError:
    return AppError(status.HTTP_410_GONE, detail, code)
