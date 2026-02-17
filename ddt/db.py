from __future__ import annotations

import sqlite3
from datetime import date
from pathlib import Path
from typing import Optional

from .models import Decision
from .utils import format_date, parse_date


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  impact INTEGER NOT NULL,
  stress INTEGER NOT NULL,
  created_date TEXT NOT NULL,
  due_date TEXT,
  resolved_date TEXT
);

CREATE INDEX IF NOT EXISTS idx_decisions_resolved_date ON decisions(resolved_date);
CREATE INDEX IF NOT EXISTS idx_decisions_created_date ON decisions(created_date);
"""


def connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)
    conn.commit()


def add_decision(
    conn: sqlite3.Connection,
    *,
    title: str,
    category: str,
    impact: int,
    stress: int,
    created_date: date,
    due_date: Optional[date],
) -> int:
    cur = conn.execute(
        """
        INSERT INTO decisions (title, category, impact, stress, created_date, due_date, resolved_date)
        VALUES (?, ?, ?, ?, ?, ?, NULL)
        """,
        (
            title.strip(),
            category.strip(),
            impact,
            stress,
            format_date(created_date),
            format_date(due_date),
        ),
    )
    conn.commit()
    return int(cur.lastrowid)


def resolve_decision(
    conn: sqlite3.Connection,
    *,
    decision_id: int,
    resolved_date: date,
) -> bool:
    cur = conn.execute(
        """
        UPDATE decisions
        SET resolved_date = ?
        WHERE id = ? AND resolved_date IS NULL
        """,
        (format_date(resolved_date), decision_id),
    )
    conn.commit()
    return cur.rowcount > 0


def _row_to_decision(row: sqlite3.Row) -> Decision:
    return Decision(
        id=int(row["id"]),
        title=str(row["title"]),
        category=str(row["category"]),
        impact=int(row["impact"]),
        stress=int(row["stress"]),
        created_date=parse_date(str(row["created_date"])),
        due_date=parse_date(str(row["due_date"])) if row["due_date"] is not None else None,
        resolved_date=parse_date(str(row["resolved_date"])) if row["resolved_date"] is not None else None,
    )


def get_decisions(conn: sqlite3.Connection, *, include_resolved: bool) -> list[Decision]:
    if include_resolved:
        cur = conn.execute("SELECT * FROM decisions ORDER BY id ASC")
    else:
        cur = conn.execute("SELECT * FROM decisions WHERE resolved_date IS NULL ORDER BY id ASC")

    rows = cur.fetchall()
    return [_row_to_decision(r) for r in rows]
