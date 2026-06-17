from datetime import time

from sqlalchemy import ForeignKey, Integer, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class LoginSchedule(Base):
    __tablename__ = "login_schedules"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    day_of_week: Mapped[int] = mapped_column(Integer, nullable=False)  # 0=Monday .. 6=Sunday
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="login_schedules")
