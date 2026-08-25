#!/bin/bash
# =========================================================
# Säkerhetskopiering av Chartles leaderboard-databas
#
# Volymen chartle_data är den ENDA kopian av allas resultat. Pusslen är
# statiska och ligger i git — den här databasen gör det inte.
#
# VIKTIGT: kopiera INTE bara /data/chartle.db med `docker cp`. API:t kör
# SQLite i WAL-läge, så färska inskick ligger i chartle.db-wal och flyttas
# in i huvudfilen först senare. En kopia av bara huvudfilen kan sakna de
# senaste dagarnas resultat.
#
# VACUUM INTO läser huvudfilen OCH WAL-filen och skriver en konsistent
# ögonblicksbild medan API:t kör.
#
# Körs manuellt:   ./scripts/backup-chartle.sh
# Körs varje natt: crontab -e  ->
#   0 2 * * * /home/betong/chartle/scripts/backup-chartle.sh >> /home/betong/backup-chartle.log 2>&1
# =========================================================

set -euo pipefail          # avbryt vid minsta fel, även i en pipe

REPOROT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPOROT"             # cron startar inte nödvändigtvis i projektkatalogen

MAL="${MAL:-$HOME/chartle-backup}"
BEHALL="${BEHALL:-14}"     # antal backuper att spara

mkdir -p "$MAL"
FIL="$MAL/chartle-$(date +%F-%H%M%S).db"
KOPIERAD=0

cleanup() {
  docker compose exec -T --user chartle api rm -f /data/backup.db >/dev/null 2>&1 || true
  if [[ "$KOPIERAD" -eq 0 ]]; then rm -f -- "$FIL"; fi
}
trap cleanup EXIT

# Kontrollera att containern faktiskt kör – annars blir felet kryptiskt.
if [[ -z "$(docker compose ps -q api)" ]]; then
  echo "FEL: API-tjänsten kör inte. Starta med: docker compose up -d" >&2
  exit 1
fi

# 1. Skriv en konsistent ögonblicksbild inne i containern.
#    --user chartle, inte root: /data ägs av användaren chartle och
#    containern kör med read_only: true + no-new-privileges. Att skriva
#    backupen som ägaren är rätt oavsett — minsta möjliga behörighet.
#    (sqlite3-binären finns inte i python:3.13-alpine, men Python gör det.)
docker compose exec -T --user chartle api python -c "
import sqlite3, os
if os.path.exists('/data/backup.db'):
    os.remove('/data/backup.db')          # rester från ett avbrutet försök
sqlite3.connect('/data/chartle.db').execute(\"VACUUM INTO '/data/backup.db'\")"

# 2. Hämta ut den och städa upp inne i containern.
docker compose cp api:/data/backup.db "$FIL"
docker compose exec -T --user chartle api rm -f /data/backup.db

# 3. Verifiera att backupen går att läsa. En backup man aldrig provat
#    är en gissning, inte en backup.
ANTAL=$(python3 -c "
import sqlite3
from contextlib import closing
with closing(sqlite3.connect('file:$FIL?mode=ro', uri=True)) as db:
    result = db.execute('PRAGMA integrity_check').fetchone()[0]
    if result != 'ok':
        raise SystemExit(f'integrity_check misslyckades: {result}')
    print(db.execute('SELECT count(*) FROM scores').fetchone()[0])")
KOPIERAD=1

# 4. Rotera: behåll de senaste, radera äldre.
mapfile -d '' BACKUPER < <(find "$MAL" -maxdepth 1 -type f -name 'chartle-*.db' -printf '%T@ %p\0' | sort -zrn)
for post in "${BACKUPER[@]:BEHALL}"; do
  rm -f -- "${post#* }"
done

# 5. Rör kvittofilen – SIST, så att den bara uppdateras när hela kedjan
#    gick igenom (ögonblicksbild, uthämtning, verifiering, rotation).
#    Tidsstämpeln på den filen är därför ett ärligt svar på frågan
#    "när lyckades backupen senast?" – en backupfil på disk bevisar bara
#    att skriptet en gång kom halvvägs.
touch "$MAL/.senast-lyckad"

echo "Backup klar: $FIL ($(du -h "$FIL" | cut -f1), $ANTAL resultat)"
