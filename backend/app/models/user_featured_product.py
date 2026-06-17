from sqlalchemy import ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class UserFeaturedProduct(Base, TimestampMixin):
    __tablename__ = "user_featured_products"
    __table_args__ = (
        UniqueConstraint("user_id", "product_id", name="uq_user_featured_product"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="featured_products")
