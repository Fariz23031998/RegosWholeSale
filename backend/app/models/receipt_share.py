from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ReceiptShare(Base, TimestampMixin):
    __tablename__ = "receipt_shares"
    __table_args__ = (
        Index("ix_receipt_shares_expires_at", "expires_at"),
        Index("ix_receipt_shares_company_created", "company_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(String(36), unique=True, nullable=False, index=True)
    company_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("companies.id"), nullable=False, index=True
    )
    created_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    is_public: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    template_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    render_context: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    storage_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    document_code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    download_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
