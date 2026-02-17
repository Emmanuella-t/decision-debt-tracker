import tempfile
import unittest
from datetime import date
from pathlib import Path

from ddt.db import add_decision, connect, get_decisions, init_db, resolve_decision


class TestDB(unittest.TestCase):
    def test_add_and_list(self):
        with tempfile.TemporaryDirectory() as td:
            db_path = Path(td) / "test.db"
            conn = connect(db_path)
            init_db(conn)

            new_id = add_decision(
                conn,
                title="Test decision",
                category="test",
                impact=3,
                stress=2,
                created_date=date(2026, 2, 1),
                due_date=None,
            )

            self.assertIsInstance(new_id, int)

            decisions = get_decisions(conn, include_resolved=False)
            self.assertEqual(len(decisions), 1)
            self.assertEqual(decisions[0].title, "Test decision")

            conn.close()

    def test_resolve(self):
        with tempfile.TemporaryDirectory() as td:
            db_path = Path(td) / "test.db"
            conn = connect(db_path)
            init_db(conn)

            new_id = add_decision(
                conn,
                title="Resolve me",
                category="test",
                impact=2,
                stress=2,
                created_date=date(2026, 2, 1),
                due_date=None,
            )

            ok = resolve_decision(conn, decision_id=new_id, resolved_date=date(2026, 2, 13))
            self.assertTrue(ok)

            ok2 = resolve_decision(conn, decision_id=new_id, resolved_date=date(2026, 2, 13))
            self.assertFalse(ok2)

            conn.close()


if __name__ == "__main__":
    unittest.main()
