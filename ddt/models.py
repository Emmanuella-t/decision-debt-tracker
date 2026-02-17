from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Optional


@dataclass(frozen=True)
class Decision:
    id: int
    title: str
    category: str
    impact: int
    stress: int
    created_date: date
    due_date: Optional[date]
    resolved_date: Optional[date]


@dataclass(frozen=True)
class DecisionWithDebt:
    decision: Decision
    debt: int
    days_open: int
    overdue_days: int
