from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class ReceiptShareCreateResponse(BaseModel):
    share_id: str
    url: str
    expires_at: datetime
    filename: str


class ReceiptShareExpiredResponse(BaseModel):
    detail: str
    code: Literal["RECEIPT_SHARE_EXPIRED"]
