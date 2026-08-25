#!/usr/bin/env bash
# Säker återställning av leaderboarden. Gör inget utan --apply.
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Användning: $0 BACKUP.db [--apply]" >&2
  exit 2
fi

KALLA="$(realpath "$1")"
if [[ ! -f "$KALLA" ]]; then
  echo "FEL: backupen finns inte: $KALLA" >&2
  exit 1
fi

python3 -c "import sqlite3; db=sqlite3.connect('file:$KALLA?mode=ro', uri=True); result=db.execute('PRAGMA integrity_check').fetchone()[0]; assert result == 'ok', result; print(db.execute('SELECT count(*) FROM scores').fetchone()[0], 'resultat verifierade')"

if [[ "${2:-}" != "--apply" ]]; then
  echo "Torrkörning klar. Kör samma kommando med --apply för att återställa."
  exit 0
fi

REPOROT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPOROT"
STAMP="$(date +%F-%H%M%S)"

docker compose stop api
docker compose run --rm --no-deps -v "$KALLA:/restore.db:ro" api python -c \
  "import os, sqlite3; target='/data/chartle.db'; temp=target+'.restore'; [os.remove(p) for p in (temp, target, target+'-wal', target+'-shm') if os.path.exists(p)]; source=sqlite3.connect('file:/restore.db?mode=ro', uri=True); destination=sqlite3.connect(temp); source.backup(destination); destination.close(); source.close(); os.replace(temp, target)"
docker compose start api

echo "Återställning klar $STAMP. Kontrollera: curl http://127.0.0.1:8137/api/health"
