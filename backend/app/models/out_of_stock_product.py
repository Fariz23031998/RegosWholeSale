from sqlalchemy import Index, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class OutOfStockProduct(Base, TimestampMixin):
    __tablename__ = "out_of_stock_products"
    __table_args__ = (
        Index("ix_out_of_stock_products_company_created", "company_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    stock_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    company_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
