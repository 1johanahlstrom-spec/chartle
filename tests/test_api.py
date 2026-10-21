import sqlite3
import tempfile
import threading
import unittest
import uuid
from contextlib import closing
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError
from urllib.request import urlopen

from server.app import (
    LEADERBOARD_WINDOW_DAYS,
    MAX_DAY_R,
    MIN_DAYS_FOR_AVERAGE,
    RateLimiter,
    ChartleHandler,
    database_healthy,
    average_leaderboard,
    current_puzzle_no,
    init_db,
    insert_score,
    requested_player_id,
    resolve_client_ip,
    today_leaderboard,
    total_leaderboard,
    window_leaderboard,
)
from http.server import ThreadingHTTPServer


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

    @staticmethod
    def recent(offset=0):
        """Ett dagnummer som ligger inom det rullande fönstret.

        Hårdkodad dag 1 fungerar bara så länge spelet är yngre än
        LEADERBOARD_WINDOW_DAYS — sedan faller den tyst ur listan och testet
        blir grönt av fel anledning.
        """
        return current_puzzle_no() - offset

    def test_today_is_sorted(self):
        self.score(1, self.alice, "Alice", 1.25)
        self.score(1, self.bob, "Bob", 2.5)
        rows = today_leaderboard(1, 25, self.db_path)
        self.assertEqual([row["name"] for row in rows], ["Bob", "Alice"])

    def test_total_uses_latest_name(self):
        self.score(self.recent(1), self.alice, "Alice", 1.25)
        self.score(self.recent(0), self.alice, "Alicia", 2.25)
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
        # Dagens nummer går igenom, men serverns Stockholm-klocka är
        # auktoritativ och morgondagen får inte bokas i förväg.
        self.score(current_puzzle_no(), self.alice, "Alice", 1)
        with self.assertRaises(ValueError):
            self.score(current_puzzle_no() + 1, self.bob, "Bob", 1)

    def test_absurd_scores_are_rejected(self):
        for bad in (301, -301, 10 ** 400, float("inf"), float("nan")):
            with self.subTest(day_r=bad), self.assertRaises(ValueError):
                self.score(1, self.alice, "Alice", bad)

    def test_realistic_scores_are_accepted(self):
        self.score(self.recent(1), self.alice, "Alice", 12.5)
        self.score(self.recent(0), self.alice, "Alice", -8.25)
        rows = total_leaderboard(25, self.db_path)
        self.assertAlmostEqual(rows[0]["total_r"], 4.3)   # SQL rundar till 1 decimal

    def test_total_only_counts_the_rolling_window(self):
        """En lyckoträff ska blekna, inte låsa listan för alltid."""
        old = current_puzzle_no() - LEADERBOARD_WINDOW_DAYS - 1
        if old >= 1:                       # bara meningsfullt när spelet hunnit dit
            self.score(old, self.alice, "Alice", 250)
        self.score(self.recent(0), self.bob, "Bob", 3)
        rows = total_leaderboard(25, self.db_path)
        self.assertEqual([row["name"] for row in rows], ["Bob"])

    def test_average_ranks_consistency_over_volume(self):
        """Snittlistan ska belöna jämnhet, inte antal spelade dagar."""
        for offset in range(4):            # Alice: fyra dagar à 2R = snitt 2.0
            self.score(self.recent(offset), self.alice, "Alice", 2)
        for offset in range(4):            # Bob: en toppdag och tre svaga
            self.score(self.recent(offset), self.bob, "Bob", 9 if offset == 0 else -1)

        by_total = [row["name"] for row in total_leaderboard(25, self.db_path)]
        by_average = [row["name"] for row in average_leaderboard(25, self.db_path)]
        self.assertEqual(by_total, ["Alice", "Bob"])       # 8.0 mot 6.0
        self.assertEqual(by_average, ["Alice", "Bob"])     # 2.0 mot 1.5
        self.assertEqual(average_leaderboard(25, self.db_path)[0]["avg_r"], 2.0)

    def test_average_needs_a_minimum_number_of_days(self):
        """Annars toppas snittlistan av den som spelat exakt en bra dag."""
        self.score(self.recent(0), self.alice, "Endagsunder", 10)
        self.assertEqual(average_leaderboard(25, self.db_path), [])

        for offset in range(MIN_DAYS_FOR_AVERAGE):
            self.score(self.recent(offset), self.bob, "Bob", 1)
        self.assertEqual(
            [row["name"] for row in average_leaderboard(25, self.db_path)], ["Bob"]
        )

    def test_leaderboard_order_is_whitelisted(self):
        """order går rakt in i SQL:en och får aldrig komma från en query-parameter."""
        with self.assertRaises(ValueError):
            window_leaderboard(25, self.db_path, "day_r DESC; DROP TABLE scores")

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

    def test_player_ids_are_never_public(self):
        """UUID:t är spelarens hemliga nyckel — listan får bara visa "me"."""
        self.score(self.recent(0), self.alice, "Alice", 1.5)
        self.score(self.recent(0), self.bob, "Bob", 2.5)
        rows = today_leaderboard(self.recent(0), 25, self.db_path, me_id=self.alice)
        self.assertTrue(all("player_id" not in row for row in rows))
        by_name = {row["name"]: row for row in rows}
        self.assertTrue(by_name["Alice"]["me"])
        self.assertFalse(by_name["Bob"]["me"])

    def test_window_lists_also_hide_player_ids(self):
        for offset in range(4):
            self.score(self.recent(offset), self.alice, "Alice", 1)
            self.score(self.recent(offset), self.bob, "Bob", 2)
        for rows in (
            total_leaderboard(25, self.db_path, me_id=self.alice),
            average_leaderboard(25, self.db_path, me_id=self.alice),
        ):
            self.assertTrue(rows)
            self.assertTrue(all("player_id" not in row for row in rows))
            self.assertTrue(all(row["me"] is (row["name"] == "Alice") for row in rows))

    def test_check_constraint_matches_the_python_limit(self):
        """SQL-taket och MAX_DAY_R måste följas åt, annars nekar databasen tyst."""
        with closing(sqlite3.connect(self.db_path)) as db:
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
        with closing(sqlite3.connect(self.db_path)) as db:
            with db:
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
        with closing(sqlite3.connect(self.db_path)) as db:
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


class ClientIpTest(unittest.TestCase):
    def test_uses_a_valid_forwarded_address(self):
        # Caddy sätter X-Real-IP från {client_ip}; den måste gå före peer-IP:n
        # annars delar alla spelare på en enda rate-limit-kvot.
        self.assertEqual(resolve_client_ip("203.0.113.7", "172.18.0.5"), "203.0.113.7")

    def test_invalid_forwarded_address_falls_back_to_peer(self):
        for bad in ("", "inte-en-ip", "1.2.3.4, 5.6.7.8", "999.999.999.999"):
            with self.subTest(value=bad):
                self.assertEqual(resolve_client_ip(bad, "172.18.0.5"), "172.18.0.5")

    def test_ipv6_is_normalised(self):
        self.assertEqual(resolve_client_ip("2001:0db8::1", "172.18.0.5"), "2001:db8::1")

    def test_optional_player_header_is_validated(self):
        player = str(uuid.uuid4())
        self.assertEqual(requested_player_id({"X-Player-Id": player}), player)
        self.assertEqual(requested_player_id({"X-Player-Id": f" {player.upper()} "}), player)
        self.assertIsNone(requested_player_id({"X-Player-Id": "inte-ett-uuid"}))
        self.assertIsNone(requested_player_id({}))


class HealthTest(unittest.TestCase):
    def test_database_health_checks_the_real_database(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "chartle.db"
            self.assertFalse(database_healthy(path))
            init_db(path)
            self.assertTrue(database_healthy(path))

    def test_http_health_reports_database_failure(self):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", 0), ChartleHandler)
        except PermissionError:
            self.skipTest("miljön tillåter inte lokala sockets")
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with mock.patch("server.app.database_healthy", return_value=False):
                with self.assertRaises(HTTPError) as caught:
                    urlopen(f"http://127.0.0.1:{server.server_port}/api/health", timeout=2)
                self.assertEqual(caught.exception.code, 503)
                caught.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
