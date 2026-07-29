import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path

from server.app import (
    MAX_DAY_R,
    RateLimiter,
    current_puzzle_no,
    init_db,
    insert_score,
    today_leaderboard,
    total_leaderboard,
)


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
            self.score(1, self.alice, "Alice", MAX_DAY_R + 1)

    def test_future_days_are_rejected(self):
        """Ingen ska kunna fylla listan för dagar som inte inträffat än."""
        future = current_puzzle_no() + 5
        with self.assertRaises(ValueError):
            self.score(future, self.alice, "Alice", 1)
        # Dagens och morgondagens nummer ska däremot gå igenom (tidszonsglapp).
        self.score(current_puzzle_no(), self.alice, "Alice", 1)
        self.score(current_puzzle_no() + 1, self.bob, "Bob", 1)

    def test_absurd_scores_are_rejected(self):
        for bad in (301, -301, 10 ** 400, float("inf"), float("nan")):
            with self.subTest(day_r=bad), self.assertRaises(ValueError):
                self.score(1, self.alice, "Alice", bad)

    def test_realistic_scores_are_accepted(self):
        self.score(1, self.alice, "Alice", 12.5)
        self.score(2, self.alice, "Alice", -8.25)
        rows = total_leaderboard(25, self.db_path)
        self.assertAlmostEqual(rows[0]["total_r"], 4.3)   # SQL rundar till 1 decimal

    def test_extreme_but_playable_scores_are_accepted(self):
        """Taket får inte avvisa resultat som faktiskt går att spela fram.

        Chartle #250 ger 251.4R vid perfekt spel med 2 %-stopp (GME-squeezen
        2021-02-23 ligger i det dygnet). Det gamla taket på 40R gjorde att
        just den spelaren aldrig kom in på listan. Dagnumret här måste vara
        ett som redan inträffat — annars är det dagkollen som avvisar, inte
        taket, och testet skulle bli grönt av fel anledning.
        """
        today = current_puzzle_no()
        self.score(today, self.alice, "Alice", 251.4)
        rows = today_leaderboard(today, 25, self.db_path)
        self.assertEqual(rows[0]["day_r"], 251.4)

    def test_check_constraint_matches_the_python_limit(self):
        """SQL-taket och MAX_DAY_R måste följas åt, annars nekar databasen tyst."""
        with sqlite3.connect(self.db_path) as db:
            schema = db.execute(
                "SELECT sql FROM sqlite_master WHERE name = 'scores'"
            ).fetchone()[0]
        self.assertIn(f"BETWEEN {-MAX_DAY_R:g} AND {MAX_DAY_R:g}", schema)


class SchemaMigrationTest(unittest.TestCase):
    """En databas med det gamla ±100-taket ska byggas om utan att tappa rader."""

    OLD_SCHEMA = """
        CREATE TABLE scores (
            id         INTEGER PRIMARY KEY,
            day        INTEGER NOT NULL CHECK (day >= 1),
            player_id  TEXT NOT NULL,
            name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 20),
            day_r      REAL NOT NULL CHECK (day_r BETWEEN -100 AND 100),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (day, player_id)
        )
    """

    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "chartle.db"
        with sqlite3.connect(self.db_path) as db:
            db.execute(self.OLD_SCHEMA)
            db.execute(
                "INSERT INTO scores(day, player_id, name, day_r) VALUES (?, ?, ?, ?)",
                (1, str(uuid.uuid4()), "Gammal", 12.5),
            )

    def tearDown(self):
        self.tempdir.cleanup()

    def test_rows_survive_the_rebuild(self):
        init_db(self.db_path)
        rows = today_leaderboard(1, 25, self.db_path)
        self.assertEqual([row["name"] for row in rows], ["Gammal"])
        self.assertEqual(rows[0]["day_r"], 12.5)

    def test_new_limit_applies_after_the_rebuild(self):
        init_db(self.db_path)
        insert_score(
            {"day": 2, "player_id": str(uuid.uuid4()), "name": "Ny", "day_r": 251.4},
            self.db_path,
        )
        self.assertEqual(today_leaderboard(2, 25, self.db_path)[0]["day_r"], 251.4)

    def test_rebuild_is_idempotent(self):
        init_db(self.db_path)
        init_db(self.db_path)                     # andra starten ska inte röra något
        self.assertEqual(len(today_leaderboard(1, 25, self.db_path)), 1)
        with sqlite3.connect(self.db_path) as db:
            leftovers = db.execute(
                "SELECT name FROM sqlite_master WHERE name = 'scores_rebuild'"
            ).fetchall()
        self.assertEqual(leftovers, [], "temporär tabell lämnades kvar")


class RateLimiterTest(unittest.TestCase):
    def test_blocks_after_limit_per_ip(self):
        limiter = RateLimiter(limit=3, window=3600)
        self.assertEqual([limiter.check("1.2.3.4") for _ in range(4)],
                         [True, True, True, False])

    def test_other_ips_are_unaffected(self):
        limiter = RateLimiter(limit=1, window=3600)
        self.assertTrue(limiter.check("1.2.3.4"))
        self.assertFalse(limiter.check("1.2.3.4"))
        self.assertTrue(limiter.check("5.6.7.8"))

    def test_window_expiry_frees_the_quota(self):
        limiter = RateLimiter(limit=1, window=0.0)   # allt är omedelbart gammalt
        self.assertTrue(limiter.check("1.2.3.4"))
        self.assertTrue(limiter.check("1.2.3.4"))


if __name__ == "__main__":
    unittest.main()
