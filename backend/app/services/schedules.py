from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.models import LoginSchedule


def _resolve_timezone(name: str):
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, Exception):
        return timezone.utc


def is_within_login_schedule(schedules: list[LoginSchedule], timezone_name: str) -> bool:
    if not schedules:
        return True
    tz = _resolve_timezone(timezone_name)
    now = datetime.now(tz)
    current_time = now.time()
    current_day = now.weekday()
    for schedule in schedules:
        if schedule.day_of_week != current_day:
            continue
        if schedule.start_time <= current_time <= schedule.end_time:
            return True
    return False


def schedule_to_dict(schedule: LoginSchedule) -> dict:
    return {
        "id": schedule.id,
        "day_of_week": schedule.day_of_week,
        "start_time": schedule.start_time.strftime("%H:%M"),
        "end_time": schedule.end_time.strftime("%H:%M"),
    }
