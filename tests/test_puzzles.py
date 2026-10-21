"""Kontroller av de byggda pusselfilerna i docs/puzzles/.

Fångar hela kategorin "trasig data" på en gång — framför allt att
auto_adjust=True i fetch_data.py faktiskt gör sitt jobb, så att ingen split
ser ut som en krasch mitt i charten.
"""

import base64
import json
import unittest
from pathlib import Path

PUZZLE_DIR = Path(__file__).resolve().parent.parent / "docs" / "puzzles"
TOTAL_PUZZLES = 1825
VISIBLE = 60
WINDOW = 70

# En ojusterad split syns som ett FALL som träffar en hel splitkvot: 2:1 ger
# exakt -50 %, 3:1 -67 %, 10:1 -90 %. Magnitud ensam duger inte som test —
# äkta rörelser i GME/AMC/MARA går till +300 % och -60 %. Uppgångar kollas
# inte alls: en omvänd split ser likadan ut som en äkta rally.
SPLIT_RATIOS = (2.0, 3.0, 4.0, 5.0, 10.0)
SPLIT_TOLERANCE = 0.02


def load_all():
    for idx in range(TOTAL_PUZZLES):
        path = PUZZLE_DIR / f"{idx}.json"
        with path.open() as handle:
            yield idx, json.load(handle)


class PuzzleDataTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not PUZZLE_DIR.is_dir():
            raise unittest.SkipTest(f"{PUZZLE_DIR} saknas — kör build_puzzles.py först")
        cls.puzzles = dict(load_all())

    def test_all_files_exist_and_are_numbered_0_to_1824(self):
        found = sorted(int(p.stem) for p in PUZZLE_DIR.glob("*.json"))
        self.assertEqual(found, list(range(TOTAL_PUZZLES)))

    def test_shape_is_consistent(self):
        for idx, puzzle in self.puzzles.items():
            with self.subTest(puzzle=idx):
                self.assertEqual(puzzle["visible"], VISIBLE)
                for key in ("o", "h", "l", "c", "v"):
                    self.assertEqual(len(puzzle[key]), WINDOW, f"fält {key}")

    def test_entry_is_normalised_to_100(self):
        for idx, puzzle in self.puzzles.items():
            with self.subTest(puzzle=idx):
                self.assertAlmostEqual(puzzle["c"][VISIBLE - 1], 100.0, places=1)

    def test_candles_are_internally_valid(self):
        for idx, puzzle in self.puzzles.items():
            with self.subTest(puzzle=idx):
                for i in range(WINDOW):
                    low, high = puzzle["l"][i], puzzle["h"][i]
                    self.assertLessEqual(low, high, f"dag {i}: low > high")
                    self.assertTrue(low <= puzzle["o"][i] <= high, f"dag {i}: open utanför spannet")
                    self.assertTrue(low <= puzzle["c"][i] <= high, f"dag {i}: close utanför spannet")
                    self.assertGreater(low, 0, f"dag {i}: pris <= 0")

    def test_no_unadjusted_split_looks_like_a_crash(self):
        """Inget prisfall som träffar en exakt splitkvot — då saknas justeringen.

        Fångade två äkta fall: MCD 1968 och 1969, båda med en 2:1-split i
        utfallsfönstret som Yahoo saknar. Se pipeline/repair_splits.py.
        """
        for idx, puzzle in self.puzzles.items():
            closes = puzzle["c"]
            for i in range(1, WINDOW):
                quotient = closes[i - 1] / closes[i]        # >1 = prisfall
                for ratio in SPLIT_RATIOS:
                    if abs(quotient / ratio - 1) >= SPLIT_TOLERANCE:
                        continue
                    meta = json.loads(base64.b64decode(puzzle["meta"]))
                    self.fail(
                        f"Pussel {idx} ({meta['ticker']}, {meta['decision']}): "
                        f"fall på dag {i} med kvot {quotient:.3f} ≈ {ratio:g}:1. "
                        "Ser ut som en ojusterad split — kontrollera "
                        "auto_adjust=True i fetch_data.py och kör repair_splits.py."
                    )

    def test_meta_is_complete(self):
        for idx, puzzle in self.puzzles.items():
            with self.subTest(puzzle=idx):
                meta = json.loads(base64.b64decode(puzzle["meta"]))
                for key in ("ticker", "category", "decision", "fwdRetPct", "answer"):
                    self.assertIn(key, meta)
                self.assertIn(meta["answer"], ("long", "short", "neutral"))

    def test_answer_label_matches_forward_return(self):
        """Facittexten ska stämma med prisserien i samma fil.

        fwdRetPct visas för spelaren efter varje runda och måste vara exakt.
        answer är däremot kosmetisk — poängen räknas alltid från prisserien i
        computeR — så där räcker det att riktningen stämmer.
        """
        for idx, puzzle in self.puzzles.items():
            with self.subTest(puzzle=idx):
                meta = json.loads(base64.b64decode(puzzle["meta"]))
                actual = (puzzle["c"][-1] / puzzle["c"][VISIBLE - 1] - 1) * 100
                self.assertAlmostEqual(actual, meta["fwdRetPct"], places=0)
                if meta["answer"] == "long":
                    self.assertGreater(actual, 0)
                elif meta["answer"] == "short":
                    self.assertLess(actual, 0)
                else:
                    self.assertLess(abs(actual), 2.5)


if __name__ == "__main__":
    unittest.main()
