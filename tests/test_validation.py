import tempfile
import unittest
from datetime import date
from pathlib import Path

from ddt.db import add_decision, connect, get_decisions, init_db, resolve_decision
from ddt.utils import DateParseError, parse_date
from ddt.validation import DecisionDataError, validate_new_decision, validate_resolution


TODAY = date(2026, 10, 15)


class TestValidation(unittest.TestCase):
    def test_leap_day_and_impossible_dates(self):
        self.assertEqual(parse_date("2024-02-29"), date(2024, 2, 29))
        self.assertEqual(parse_date("2000-02-29"), date(2000, 2, 29))
        with self.assertRaises(DateParseError):
            parse_date("2023-02-29")
        with self.assertRaises(DateParseError):
            parse_date("1900-02-29")
        with self.assertRaises(DateParseError):
            parse_date("2026-04-31")

    def test_rejects_blank_and_long_title(self):
        with self.assertRaises(DecisionDataError):
            validate_new_decision(
                title="   ",
                category="ops",
                impact=3,
                stress=3,
                created_date=TODAY,
                due_date=None,
                today=TODAY,
            )
        with self.assertRaises(DecisionDataError):
            validate_new_decision(
                title="x" * 121,
                category="ops",
                impact=3,
                stress=3,
                created_date=TODAY,
                due_date=None,
                today=TODAY,
            )

    def test_due_before_created_and_future_created(self):
        with self.assertRaises(DecisionDataError):
            validate_new_decision(
                title="Late start",
                category="ops",
                impact=3,
                stress=2,
                created_date=date(2026, 10, 16),
                due_date=None,
                today=TODAY,
            )
        with self.assertRaises(DecisionDataError):
            validate_new_decision(
                title="Backwards",
                category="ops",
                impact=3,
                stress=2,
                created_date=date(2026, 10, 10),
                due_date=date(2026, 10, 1),
                today=TODAY,
            )

    def test_overdue_due_date_is_allowed(self):
        title, category = validate_new_decision(
            title="  Already late  ",
            category=" ops ",
            impact=4,
            stress=4,
            created_date=date(2026, 9, 1),
            due_date=date(2026, 9, 15),
            today=TODAY,
        )
        self.assertEqual(title, "Already late")
        self.assertEqual(category, "ops")

    def test_resolution_rules(self):
        with self.assertRaises(DecisionDataError):
            validate_resolution(
                created_date=date(2026, 10, 10),
                resolved_date=date(2026, 10, 1),
                today=TODAY,
            )
        with self.assertRaises(DecisionDataError):
            validate_resolution(
                created_date=date(2026, 10, 1),
                resolved_date=date(2026, 10, 16),
                today=TODAY,
            )
        validate_resolution(
            created_date=date(2026, 10, 1),
            resolved_date=date(2026, 10, 14),
            today=TODAY,
        )

    def test_invalid_ratings(self):
        for impact in (0, 6, -1):
            with self.assertRaises(DecisionDataError):
                validate_new_decision(
                    title="Rating",
                    category="ops",
                    impact=impact,
                    stress=3,
                    created_date=TODAY,
                    due_date=None,
                    today=TODAY,
                )

    def test_database_rejects_invalid_record(self):
        with tempfile.TemporaryDirectory() as td:
            conn = connect(Path(td) / "test.db")
            init_db(conn)
            with self.assertRaises(DecisionDataError):
                add_decision(
                    conn,
                    title="Bad order",
                    category="ops",
                    impact=3,
                    stress=3,
                    created_date=date(2026, 10, 10),
                    due_date=date(2026, 10, 1),
                    today=TODAY,
                )
            self.assertEqual(get_decisions(conn, include_resolved=True), [])

            new_id = add_decision(
                conn,
                title="Valid",
                category="ops",
                impact=3,
                stress=3,
                created_date=date(2026, 10, 1),
                due_date=date(2026, 10, 20),
                today=TODAY,
            )
            with self.assertRaises(DecisionDataError):
                resolve_decision(
                    conn,
                    decision_id=new_id,
                    resolved_date=date(2026, 9, 1),
                    today=TODAY,
                )
            self.assertIsNone(get_decisions(conn, include_resolved=True)[0].resolved_date)
            conn.close()


if __name__ == "__main__":
    unittest.main()
