from typing import Any

from sqlalchemy import JSON, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class UserSetting(Base):
    __tablename__ = "user_settings"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_user_setting_key"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    value: Mapped[Any] = mapped_column(JSON, nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="settings")
