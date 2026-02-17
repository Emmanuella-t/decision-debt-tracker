from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from typing import Optional


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


@dataclass(frozen=True)
class DebtBreakdown:
    debt: int
    days_open: int
    overdue_days: int
    severity: float
    growth: float
    overdue_boost: float


def compute_debt(
    *,
    created_date: date,
    due_date: Optional[date],
    impact: int,
    stress: int,
    today: date,
) -> DebtBreakdown:
    """
    Debt score: 0..100

    - growth = 1 - exp(-days_open/21)
    - severity = (impact + stress)/10  in [0.2..1.0]
    - overdue_boost = 1 + min(0.5, overdue_days/30)
    - debt = round(clamp(100 * growth * severity * overdue_boost, 0, 100))
    """
    days_open = max(0, (today - created_date).days)

    if not (1 <= impact <= 5):
        raise ValueError("impact must be between 1 and 5")
    if not (1 <= stress <= 5):
        raise ValueError("stress must be between 1 and 5")

    severity = (impact + stress) / 10.0
    growth = 1.0 - math.exp(-days_open / 21.0)

    overdue_days = 0
    if due_date is not None:
        overdue_days = max(0, (today - due_date).days)

    overdue_boost = 1.0 + min(0.5, overdue_days / 30.0)

    raw_debt = 100.0 * growth * severity * overdue_boost
    debt = int(round(clamp(raw_debt, 0.0, 100.0)))

    return DebtBreakdown(
        debt=debt,
        days_open=days_open,
        overdue_days=overdue_days,
        severity=severity,
        growth=growth,
        overdue_boost=overdue_boost,
    )


def compute_health_score(total_debt: int) -> int:
    """
    Health score: 0..100, higher is better.

    health = round(100 * exp(-total_debt/200))
    """
    if total_debt < 0:
        total_debt = 0
    health = 100.0 * math.exp(-total_debt / 200.0)
    return int(round(clamp(health, 0.0, 100.0)))
