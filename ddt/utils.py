from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime


DATE_FMT = "%Y-%m-%d"


class DateParseError(ValueError):
    pass


def parse_date(value: str) -> date:
    try:
        return datetime.strptime(value, DATE_FMT).date()
    except Exception as exc:
        raise DateParseError(f"Invalid date '{value}'. Expected format YYYY-MM-DD.") from exc


def format_date(d: date | None) -> str | None:
    if d is None:
        return None
    return d.strftime(DATE_FMT)


@dataclass(frozen=True)
class Clock:
    """
    Lets tests control "today" deterministically by injecting a Clock.
    """
    today_value: date | None = None

    def today(self) -> date:
        return self.today_value or date.today()
