import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path

from server.app import init_db, insert_score, today_leaderboard, total_leaderboard


class LeaderboardTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "chartle.db"
        init_db(self.db_path)
        self.alice = str(uuid.uuid4())
        self.bob = str(uuid.uuid4())

    def tearDown(self):
        self.tempdir.cleanup()

    def score(self, day, player_id, name, day_r):
        insert_score(
            {"day": day, "player_id": player_id, "name": name, "day_r": day_r},
            self.db_path,
        )

    def test_today_is_sorted(self):
        self.score(1, self.alice, "Alice", 1.25)
        self.score(1, self.bob, "Bob", 2.5)
        rows = today_leaderboard(1, 25, self.db_path)
        self.assertEqual([row["name"] for row in rows], ["Bob", "Alice"])

    def test_total_uses_latest_name(self):
        self.score(1, self.alice, "Alice", 1.25)
        self.score(2, self.alice, "Alicia", 2.25)
        rows = total_leaderboard(25, self.db_path)
        self.assertEqual(rows[0]["name"], "Alicia")
        self.assertEqual(rows[0]["total_r"], 3.5)
        self.assertEqual(rows[0]["days"], 2)

    def test_duplicate_day_is_rejected(self):
        self.score(1, self.alice, "Alice", 1)
        with self.assertRaises(sqlite3.IntegrityError):
            self.score(1, self.alice, "Alice", 2)

    def test_invalid_input_is_rejected(self):
        with self.assertRaises(ValueError):
            self.score(0, self.alice, "Alice", 1)
        with self.assertRaises(ValueError):
            self.score(1, "not-a-uuid", "Alice", 1)
        with self.assertRaises(ValueError):
            self.score(1, self.alice, "", 1)
        with self.assertRaises(ValueError):
            self.score(1, self.alice, "Alice", 101)


if __name__ == "__main__":
    unittest.main()
