#!/usr/bin/env python3
"""Chartles lilla leaderboard-API, byggt enbart med Pythons standardbibliotek."""

from __future__ import annotations

import json
import math
import os
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


DB_PATH = Path(os.environ.get("CHARTLE_DB_PATH", "/data/chartle.db"))
MAX_BODY_BYTES = 8_192
MAX_LEADERBOARD_ROWS = 100


def connect(db_path: Path = DB_PATH) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
    return connection


def init_db(db_path: Path = DB_PATH) -> None:
    with connect(db_path) as db:
        db.execute("PRAGMA journal_mode = WAL")
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS scores (
                id         INTEGER PRIMARY KEY,
                day        INTEGER NOT NULL CHECK (day >= 1),
                player_id  TEXT NOT NULL,
                name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 20),
                day_r      REAL NOT NULL CHECK (day_r BETWEEN -100 AND 100),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (day, player_id)
            )
            """
        )
        db.execute(
            "CREATE INDEX IF NOT EXISTS scores_day_r_idx ON scores(day, day_r DESC)"
        )


@contextmanager
def database(db_path: Path = DB_PATH):
    db = connect(db_path)
    try:
        yield db
        db.commit()
    finally:
        db.close()


def clean_score(payload: object) -> tuple[int, str, str, float]:
    if not isinstance(payload, dict):
        raise ValueError("JSON-objekt krävs")

    day = payload.get("day")
    if isinstance(day, bool) or not isinstance(day, int) or day < 1:
        raise ValueError("Ogiltig dag")

    try:
        player_id = str(uuid.UUID(str(payload.get("player_id", ""))))
    except ValueError as error:
        raise ValueError("Ogiltigt spelar-id") from error

    name = payload.get("name")
    if not isinstance(name, str):
        raise ValueError("Ogiltigt namn")
    name = " ".join(name.strip().split())
    if not 1 <= len(name) <= 20 or any(ord(char) < 32 for char in name):
        raise ValueError("Namnet måste vara 1–20 tecken")

    day_r = payload.get("day_r")
    if isinstance(day_r, bool) or not isinstance(day_r, (int, float)):
        raise ValueError("Ogiltig poäng")
    day_r = round(float(day_r), 2)
    if not math.isfinite(day_r) or not -100 <= day_r <= 100:
        raise ValueError("Ogiltig poäng")

    return day, player_id, name, day_r


def insert_score(payload: object, db_path: Path = DB_PATH) -> None:
    score = clean_score(payload)
    with database(db_path) as db:
        db.execute(
            "INSERT INTO scores(day, player_id, name, day_r) VALUES (?, ?, ?, ?)",
            score,
        )


def today_leaderboard(day: int, limit: int, db_path: Path = DB_PATH) -> list[dict]:
    with database(db_path) as db:
        rows = db.execute(
            """
            SELECT player_id, name, day_r
            FROM scores
            WHERE day = ?
            ORDER BY day_r DESC, created_at ASC, id ASC
            LIMIT ?
            """,
            (day, limit),
        ).fetchall()
    return [dict(row) for row in rows]


def total_leaderboard(limit: int, db_path: Path = DB_PATH) -> list[dict]:
    with database(db_path) as db:
        rows = db.execute(
            """
            SELECT
                scores.player_id,
                (
                    SELECT latest.name
                    FROM scores AS latest
                    WHERE latest.player_id = scores.player_id
                    ORDER BY latest.created_at DESC, latest.id DESC
                    LIMIT 1
                ) AS name,
                ROUND(SUM(scores.day_r), 1) AS total_r,
                COUNT(*) AS days
            FROM scores
            GROUP BY scores.player_id
            ORDER BY total_r DESC, days DESC, scores.player_id ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


class ChartleHandler(BaseHTTPRequestHandler):
    server_version = "ChartleAPI/1.0"

    def send_json(self, status: int, body: object) -> None:
        data = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        try:
            if parsed.path == "/api/health":
                self.send_json(200, {"status": "ok"})
                return
            if parsed.path == "/api/leaderboard/today":
                day = positive_int(query, "day")
                self.send_json(200, today_leaderboard(day, row_limit(query)))
                return
            if parsed.path == "/api/leaderboard/total":
                self.send_json(200, total_leaderboard(row_limit(query)))
                return
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
            return
        self.send_json(404, {"error": "Hittades inte"})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if urlparse(self.path).path != "/api/scores":
            self.send_json(404, {"error": "Hittades inte"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY_BYTES:
                raise ValueError("Ogiltig storlek")
            payload = json.loads(self.rfile.read(length))
            insert_score(payload)
        except json.JSONDecodeError:
            self.send_json(400, {"error": "Ogiltig JSON"})
            return
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
            return
        except sqlite3.IntegrityError:
            self.send_json(409, {"error": "Poängen är redan inskickad"})
            return
        self.send_json(201, {"status": "created"})

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}", flush=True)


def positive_int(query: dict[str, list[str]], key: str) -> int:
    try:
        value = int(query[key][0])
    except (KeyError, IndexError, TypeError, ValueError) as error:
        raise ValueError(f"Ogiltig parameter: {key}") from error
    if value < 1:
        raise ValueError(f"Ogiltig parameter: {key}")
    return value


def row_limit(query: dict[str, list[str]]) -> int:
    if "limit" not in query:
        return 25
    return min(positive_int(query, "limit"), MAX_LEADERBOARD_ROWS)


def main() -> None:
    init_db()
    server = ThreadingHTTPServer(("0.0.0.0", 8080), ChartleHandler)
    print("Chartle API lyssnar på port 8080", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
