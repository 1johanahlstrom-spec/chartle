"""Reparera pussel där yfinance missat en split.

Yahoos splithistorik är ofullständig för 1960-talet. Två MCD-fönster innehåller
därför en ojusterad 2:1-split i UTFALLSDELEN: charten ser normal ut när spelaren
väljer, och "kraschar" sedan 50 % under utspelningen. Pussel 1480 var till och
med märkt short trots att den verkliga rörelsen var +7,6 %.

Att bygga om alla pussel är inget alternativ — det numrerar om dem och bryter
epoken (se build_puzzles.py). Det här skriptet korrigerar bara de drabbade
filerna på plats och behåller deras index.

    python3 repair_splits.py            # visa vad som skulle ändras
    python3 repair_splits.py --apply    # skriv ändringarna

Upptäckta med: leta dag-till-dag-kvoter inom 2 % av en hel splitkvot (>= 1.9).
Vanlig volatilitet i MARA/GME/AMC ligger på 1.2-1.5 och rörs inte.
"""

import argparse
import base64
import json
import sys
from pathlib import Path

VISIBLE = 60
ROOT = Path(__file__).resolve().parent.parent
PUZZLE_DIR = ROOT / "docs" / "puzzles"

# (pusselindex, första dagen EFTER spliten, splitkvot). Verifierade för hand:
# båda ligger på kvot ~2.00 i en storbolagsaktie, i en era där Yahoos
# splitdata är känt ofullständig, och efter korrigering återstår inga
# dag-till-dag-rörelser över 15 %.
KNOWN_MISSED_SPLITS = [
    (1480, 62, 2.0),   # MCD, split omkring 1968-05-21
    (1482, 63, 2.0),   # MCD, split omkring 1969-06-16
]


def relabel(fwd_ret_pct: float) -> str:
    """Etiketten är kosmetisk — spelet poängsätter alltid mot prisserien."""
    if fwd_ret_pct >= 5:
        return "long"
    if fwd_ret_pct <= -5:
        return "short"
    if fwd_ret_pct > 0:
        return "long"
    return "short" if fwd_ret_pct < 0 else "neutral"


def repair(index: int, split_day: int, ratio: float, apply: bool) -> bool:
    path = PUZZLE_DIR / f"{index}.json"
    puzzle = json.loads(path.read_text())
    meta = json.loads(base64.b64decode(puzzle["meta"]))

    before = puzzle["c"][split_day] / puzzle["c"][split_day - 1] - 1
    if abs(before) < 0.3:
        print(f"  {index}.json: ingen stor rörelse på dag {split_day} — redan lagad?")
        return False

    # Priser efter spliten multipliceras upp till samma aktieantal som före.
    # Volymen går åt andra hållet: dubbelt så många aktier omsätts efter en 2:1.
    for key in ("o", "h", "l", "c"):
        puzzle[key] = [round(x * ratio, 2) if i >= split_day else x
                       for i, x in enumerate(puzzle[key])]
    puzzle["v"] = [round(x / ratio, 2) if i >= split_day else x
                   for i, x in enumerate(puzzle["v"])]

    fwd = round((puzzle["c"][-1] / puzzle["c"][VISIBLE - 1] - 1) * 100, 1)
    old_answer, old_fwd = meta["answer"], meta["fwdRetPct"]
    meta["fwdRetPct"] = fwd
    meta["answer"] = relabel(fwd)
    puzzle["meta"] = base64.b64encode(json.dumps(meta).encode()).decode()

    after = puzzle["c"][split_day] / puzzle["c"][split_day - 1] - 1
    print(f"  {index}.json ({meta['ticker']} {meta['decision']}): "
          f"dag {split_day} {before:+.1%} → {after:+.1%}, "
          f"fwdRet {old_fwd:+.1f}% → {fwd:+.1f}%, "
          f"answer {old_answer} → {meta['answer']}")

    if apply:
        path.write_text(json.dumps(puzzle, separators=(",", ":")))
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="skriv ändringarna till disk")
    args = parser.parse_args()

    if not PUZZLE_DIR.is_dir():
        sys.exit(f"Hittar inte {PUZZLE_DIR}")

    print("Reparerar pussel med missad split:" if args.apply else "TORRKÖRNING (--apply skriver):")
    changed = sum(repair(i, d, r, args.apply) for i, d, r in KNOWN_MISSED_SPLITS)
    print(f"\n{changed} pussel {'lagade' if args.apply else 'skulle lagas'}.")


if __name__ == "__main__":
    main()
