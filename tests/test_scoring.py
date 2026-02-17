import unittest
from datetime import date

from ddt.scoring import compute_debt, compute_health_score


class TestScoring(unittest.TestCase):
    def test_created_today_is_zero(self):
        today = date(2026, 2, 13)
        b = compute_debt(
            created_date=today,
            due_date=None,
            impact=5,
            stress=5,
            today=today,
        )
        self.assertEqual(b.debt, 0)
        self.assertEqual(b.days_open, 0)

    def test_older_decision_increases(self):
        today = date(2026, 2, 13)
        created = date(2026, 1, 14)  # 30 days open
        b = compute_debt(
            created_date=created,
            due_date=None,
            impact=5,
            stress=5,
            today=today,
        )
        self.assertGreater(b.debt, 0)
        self.assertEqual(b.days_open, 30)

    def test_overdue_increases(self):
        today = date(2026, 2, 13)
        created = date(2026, 1, 1)
        due = date(2026, 2, 1)  # overdue by 12 days
        b1 = compute_debt(created_date=created, due_date=None, impact=3, stress=3, today=today)
        b2 = compute_debt(created_date=created, due_date=due, impact=3, stress=3, today=today)
        self.assertGreaterEqual(b2.debt, b1.debt)
        self.assertGreaterEqual(b2.overdue_days, 1)

    def test_health_score_bounds(self):
        self.assertEqual(compute_health_score(0), 100)
        self.assertTrue(0 <= compute_health_score(1000) <= 100)


if __name__ == "__main__":
    unittest.main()
