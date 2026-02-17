from __future__ import annotations

import argparse
from pathlib import Path

from .db import add_decision, connect, get_decisions, init_db, resolve_decision
from .models import DecisionWithDebt
from .reporting import (
    WeeklyReport,
    iso_week_key,
    parse_week,
    week_label,
    write_weekly_report_md,
)
from .scoring import compute_debt, compute_health_score
from .utils import Clock, DateParseError, parse_date


DEFAULT_DB = Path("ddt.db")
REPORTS_DIR = Path("reports")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ddt",
        description="Decision Debt Tracker",
    )

    parser.add_argument(
        "--db",
        default=str(DEFAULT_DB),
        help="Path to SQLite database file (default: ddt.db)",
    )

    sub = parser.add_subparsers(dest="command", required=True)

    # ADD
    p_add = sub.add_parser("add", help="Add a new decision")
    p_add.add_argument("--title", required=True)
    p_add.add_argument("--category", required=True)
    p_add.add_argument("--impact", required=True, type=int)
    p_add.add_argument("--stress", required=True, type=int)
    p_add.add_argument("--created", help="YYYY-MM-DD (default: today)")
    p_add.add_argument("--due", help="YYYY-MM-DD")

    # RESOLVE
    p_resolve = sub.add_parser("resolve", help="Mark decision resolved")
    p_resolve.add_argument("--id", required=True, type=int)
    p_resolve.add_argument("--resolved", help="YYYY-MM-DD (default: today)")

    # LIST
    p_list = sub.add_parser("list", help="List decisions")
    p_list.add_argument("--all", action="store_true")

    # SUMMARY
    sub.add_parser("summary", help="Show totals and health score")

    # REPORT
    p_report = sub.add_parser("report", help="Export weekly report")
    p_report.add_argument("--week", help="YYYY-WW (example: 2026-07)")

    return parser


def _validate_1_to_5(name: str, value: int) -> int:
    if value < 1 or value > 5:
        raise argparse.ArgumentTypeError(f"{name} must be between 1 and 5.")
    return value


def _open_db(db_path: Path):
    conn = connect(db_path)
    init_db(conn)
    return conn


def _compute_active_with_debt(decisions, today):
    results: list[DecisionWithDebt] = []
    for d in decisions:
        if d.resolved_date is not None:
            continue

        breakdown = compute_debt(
            created_date=d.created_date,
            due_date=d.due_date,
            impact=d.impact,
            stress=d.stress,
            today=today,
        )

        results.append(
            DecisionWithDebt(
                decision=d,
                debt=breakdown.debt,
                days_open=breakdown.days_open,
                overdue_days=breakdown.overdue_days,
            )
        )

    results.sort(key=lambda x: x.debt, reverse=True)
    return results


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    clock = Clock()
    today = clock.today()

    db_path = Path(args.db)

    try:
        conn = _open_db(db_path)

        # ---------------- ADD ----------------
        if args.command == "add":
            impact = _validate_1_to_5("impact", args.impact)
            stress = _validate_1_to_5("stress", args.stress)

            created_date = today
            if args.created:
                created_date = parse_date(args.created)

            due_date = None
            if args.due:
                due_date = parse_date(args.due)

            new_id = add_decision(
                conn,
                title=args.title,
                category=args.category,
                impact=impact,
                stress=stress,
                created_date=created_date,
                due_date=due_date,
            )

            print(f"Added decision #{new_id}: {args.title}")
            return 0

        # ---------------- RESOLVE ----------------
        if args.command == "resolve":
            resolved_date = today
            if args.resolved:
                resolved_date = parse_date(args.resolved)

            ok = resolve_decision(
                conn,
                decision_id=args.id,
                resolved_date=resolved_date,
            )

            if not ok:
                print("Error: decision not found or already resolved.")
                return 2

            print(f"Resolved decision #{args.id}")
            return 0

        # ---------------- LIST ----------------
        if args.command == "list":
            decisions = get_decisions(conn, include_resolved=args.all)
            active_with_debt = _compute_active_with_debt(decisions, today)

            if not decisions:
                print("No decisions found.")
                return 0

            print("Active decisions (sorted by debt):")

            if not active_with_debt:
                print("  None.")
            else:
                for item in active_with_debt:
                    d = item.decision
                    due = d.due_date.isoformat() if d.due_date else "-"
                    print(
                        f"  #{d.id} [{d.category}] debt={item.debt:3d} "
                        f"days_open={item.days_open:3d} "
                        f"overdue={item.overdue_days:3d} "
                        f"due={due}  {d.title}"
                    )

            return 0

        # ---------------- SUMMARY ----------------
        if args.command == "summary":
            decisions = get_decisions(conn, include_resolved=False)
            active_with_debt = _compute_active_with_debt(decisions, today)

            total_active = len(active_with_debt)
            total_debt = sum(x.debt for x in active_with_debt)
            avg_debt = round(total_debt / total_active, 1) if total_active else 0
            health = compute_health_score(total_debt)

            print(f"Active decisions: {total_active}")
            print(f"Total debt: {total_debt}")
            print(f"Average debt: {avg_debt}")
            print(f"Decision health score: {health}/100")
            return 0

        # ---------------- REPORT ----------------
        if args.command == "report":
            decisions = get_decisions(conn, include_resolved=False)
            active_with_debt = _compute_active_with_debt(decisions, today)

            if args.week:
                y, w = parse_week(args.week)
                week = week_label(y, w)
            else:
                week = iso_week_key(today)

            total_debt = sum(x.debt for x in active_with_debt)
            health = compute_health_score(total_debt)

            report = WeeklyReport(
                week=week,
                generated_on=today,
                total_active=len(active_with_debt),
                total_debt=total_debt,
                health_score=health,
                top_items=active_with_debt[:10],
            )

            path = write_weekly_report_md(report, REPORTS_DIR)
            print(f"Wrote report: {path}")
            return 0

        parser.print_help()
        return 1

    except DateParseError as e:
        print(f"Date error: {e}")
        return 2
    except Exception as e:
        print(f"Error: {e}")
        return 2
    finally:
        try:
            conn.close()
        except Exception:
            pass
