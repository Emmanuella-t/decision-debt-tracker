from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path

from .models import DecisionWithDebt


def iso_week_key(d: date) -> str:
    iso_year, iso_week, _ = d.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def parse_week(value: str) -> tuple[int, int]:
    v = value.strip()
    if "-W" in v:
        parts = v.split("-W")
    else:
        parts = v.split("-")

    if len(parts) != 2:
        raise ValueError("Invalid week format. Use YYYY-WW (example: 2026-07).")

    year = int(parts[0])
    week = int(parts[1])
    if week < 1 or week > 53:
        raise ValueError("Week number must be between 1 and 53.")
    return year, week


def week_label(year: int, week: int) -> str:
    return f"{year}-W{week:02d}"


@dataclass(frozen=True)
class WeeklyReport:
    week: str
    generated_on: date
    total_active: int
    total_debt: int
    health_score: int
    top_items: list[DecisionWithDebt]


def write_weekly_report_md(report: WeeklyReport, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{report.week}.md"

    lines: list[str] = []
    lines.append(f"# Decision Debt Report: {report.week}")
    lines.append("")
    lines.append(f"Generated on: {report.generated_on.isoformat()}")
    lines.append("")
    lines.append("## Summary")
    lines.append(f"- Active decisions: {report.total_active}")
    lines.append(f"- Total debt: {report.total_debt}")
    lines.append(f"- Decision health score: {report.health_score}/100")
    lines.append("")
    lines.append("## Top debt drivers")

    if not report.top_items:
        lines.append("_No active decisions._")
    else:
        lines.append("| ID | Title | Category | Debt | Days Open | Overdue Days | Due |")
        lines.append("|---:|---|---|---:|---:|---:|---|")
        for item in report.top_items:
            d = item.decision
            due = d.due_date.isoformat() if d.due_date else ""
            lines.append(
                f"| {d.id} | {d.title} | {d.category} | {item.debt} | {item.days_open} | {item.overdue_days} | {due} |"
            )

    lines.append("")
    lines.append("## Reflection prompts")
    lines.append("- What is one decision I can close in 20 minutes?")
    lines.append("- What is one decision I keep avoiding, and why?")
    lines.append("- If I reduce my total debt by 25 points this week, what changes?")
    lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")
    return path
