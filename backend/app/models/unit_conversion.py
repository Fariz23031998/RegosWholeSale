from decimal import Decimal

from sqlalchemy import ForeignKey, Integer, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class ItemUnitConversion(Base, TimestampMixin):
    """Per-item conversion: 1 secondary unit = N main units."""

    __tablename__ = "item_unit_conversions"
    __table_args__ = (
        UniqueConstraint(
            "company_id",
            "regos_item_id",
            name="uq_item_unit_conversions_company_item",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    regos_item_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    secondary_unit_id: Mapped[int] = mapped_column(Integer, nullable=False)
    conversion_factor: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)

    company = relationship("Company")
