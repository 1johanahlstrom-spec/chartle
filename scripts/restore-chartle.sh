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

# API:t måste tillbaka även om återställningen misslyckas mitt i — annars står
# hela spelet utan leaderboard tills någon tittar till servern.
RESTARTED=0
cleanup() {
  if [[ "$RESTARTED" -eq 1 ]]; then
    docker compose start api >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

docker compose stop api
RESTARTED=1

# Skriv till en temp-fil och verifiera den INNAN den nuvarande databasen rörs.
# Den gamla versionen raderade /data/chartle.db först och hade därför kunnat
# lämna servern utan databas om backupen visade sig vara trasig.
docker compose run --rm --no-deps -T -v "$KALLA:/restore.db:ro" api python - <<'PY'
import os
import sqlite3

target = "/data/chartle.db"
temp = target + ".restore"
for path in (temp, temp + "-wal", temp + "-shm"):
    if os.path.exists(path):
        os.remove(path)

source = sqlite3.connect("file:/restore.db?mode=ro", uri=True)
destination = sqlite3.connect(temp)
try:
    source.backup(destination)
finally:
    destination.close()
    source.close()

check = sqlite3.connect(temp)
try:
    result = check.execute("PRAGMA integrity_check").fetchone()[0]
    if result != "ok":
        raise SystemExit(f"FEL: den återställda kopian är trasig: {result}")
    count = check.execute("SELECT count(*) FROM scores").fetchone()[0]
finally:
    check.close()

# WAL/SHM tillhör den GAMLA databasen. Ligger de kvar när den nya filen byts
# in kan SQLite försöka spela upp gamla transaktioner mot fel databas.
for suffix in ("-wal", "-shm"):
    path = target + suffix
    if os.path.exists(path):
        os.remove(path)
os.replace(temp, target)
print(f"Återställde {count} resultat")
PY

docker compose start api
RESTARTED=0
trap - EXIT

PORT="${CHARTLE_PORT:-8137}"
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
    echo "Återställning klar $STAMP. API:t svarar på /api/health."
    exit 0
  fi
  sleep 1
done

echo "FEL: API:t svarar inte efter återställningen. Loggar:" >&2
docker compose logs api >&2
exit 1
