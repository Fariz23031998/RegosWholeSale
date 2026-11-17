from decimal import Decimal

from sqlalchemy import ForeignKey, Integer, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class UnitConversion(Base, TimestampMixin):
    """Company-level conversion: 1 secondary unit = N main units."""

    __tablename__ = "unit_conversions"
    __table_args__ = (
        UniqueConstraint(
            "company_id",
            "main_unit_id",
            "secondary_unit_id",
            name="uq_unit_conversions_company_main_secondary",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    main_unit_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    secondary_unit_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    conversion_factor: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    price_type_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    company = relationship("Company")
