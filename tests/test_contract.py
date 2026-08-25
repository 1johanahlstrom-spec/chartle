import datetime
import json
import re
import unittest
from pathlib import Path

from server.app import EPOCH_DATE


ROOT = Path(__file__).resolve().parent.parent


class CrossLanguageContractTest(unittest.TestCase):
    """Bevakar konstanter som måste hållas synkade mellan JS och Python."""

    def test_game_epoch_matches_server_epoch(self):
        source = (ROOT / "docs" / "game.js").read_text(encoding="utf-8")
        match = re.search(r"Date\.UTC\((\d+),\s*(\d+),\s*(\d+)\)", source)
        self.assertIsNotNone(match, "EPOCH_DAYS saknas i game.js")
        year, zero_based_month, day = map(int, match.groups())
        self.assertEqual(
            datetime.date(year, zero_based_month + 1, day),
            EPOCH_DATE,
        )

    def test_content_constants_match_puzzle_files(self):
        source = (ROOT / "docs" / "game.js").read_text(encoding="utf-8")
        rounds = int(re.search(r"const ROUNDS = (\d+)", source).group(1))
        total = int(re.search(r"const TOTAL_PUZZLES = (\d+)", source).group(1))
        files = list((ROOT / "docs" / "puzzles").glob("*.json"))
        self.assertEqual(total, len(files))
        self.assertEqual(total % rounds, 0)

    def test_pwa_manifest_references_existing_assets(self):
        docs = ROOT / "docs"
        manifest = json.loads((docs / "manifest.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual(manifest["display"], "standalone")
        self.assertTrue(manifest["icons"])
        for icon in manifest["icons"]:
            self.assertTrue((docs / icon["src"]).is_file())

        html = (docs / "index.html").read_text(encoding="utf-8")
        self.assertIn('rel="manifest" href="manifest.webmanifest"', html)
        self.assertTrue((docs / "service-worker.js").is_file())

    def test_next_generation_disallows_overlapping_windows(self):
        source = (ROOT / "pipeline" / "build_puzzles.py").read_text(encoding="utf-8")
        self.assertRegex(source, r"MIN_GAP\s*=\s*WINDOW")

    def test_service_worker_prefetches_daily_puzzles(self):
        worker = (ROOT / "docs" / "service-worker.js").read_text(encoding="utf-8")
        client = (ROOT / "docs" / "pwa.js").read_text(encoding="utf-8")
        self.assertIn("CACHE_PUZZLES", worker)
        self.assertIn("CACHE_PUZZLES", client)

    def test_accessibility_state_is_present(self):
        html = (ROOT / "docs" / "index.html").read_text(encoding="utf-8")
        self.assertIn('aria-pressed="true"', html)
        self.assertIn('role="tablist"', html)
        self.assertIn('for="lb-name"', html)


if __name__ == "__main__":
    unittest.main()
