#!/usr/bin/env bash
# Kör hela testsviten. Spellogiken körs under flera tidszoner — det är själva
# poängen med testerna av dygnsgränsen: de ska ge samma svar överallt.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Spellogik (node) =="
for tz in Pacific/Auckland Europe/Stockholm America/Los_Angeles UTC; do
	echo "-- TZ=$tz"
	TZ="$tz" node --test tests/test_game.js
done

echo
echo "== Leaderboard-API och pusseldata (python) =="
python3 -m unittest discover -s tests -t . -v
