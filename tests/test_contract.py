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

    def test_frontend_assets_and_service_worker_share_a_version(self):
        """?v= i index.html, APP_SHELL och CACHE måste bumpas tillsammans.

        Service workern kan annars installera en blandning av gammal och ny
        kod, och en glömd bump är osynlig tills något går sönder i produktion.
        """
        docs = ROOT / "docs"
        html = (docs / "index.html").read_text(encoding="utf-8")
        worker = (docs / "service-worker.js").read_text(encoding="utf-8")

        html_versions = set(re.findall(r"\?v=(\d+)", html))
        self.assertEqual(len(html_versions), 1, f"blandade versioner i index.html: {html_versions}")
        shell_versions = set(re.findall(r"\?v=(\d+)", worker))
        self.assertEqual(shell_versions, html_versions)
        cache_version = re.search(r'const CACHE = "chartle-v(\d+)"', worker)
        self.assertIsNotNone(cache_version)
        self.assertEqual({cache_version.group(1)}, html_versions)

    def test_puzzle_urls_are_versioned_everywhere(self):
        """En lagad pusselfil får aldrig serveras under en gammal cache-URL."""
        game = (ROOT / "docs" / "game.js").read_text(encoding="utf-8")
        app = (ROOT / "docs" / "app.js").read_text(encoding="utf-8")
        pwa = (ROOT / "docs" / "pwa.js").read_text(encoding="utf-8")
        self.assertRegex(game, r"const PUZZLE_VERSION = \d+;")
        self.assertRegex(game, r"function puzzleUrl\(raw\)")
        self.assertIn("puzzleUrl(fileIndexFor(round))", app)
        self.assertIn("ChartleGame.puzzleUrl", pwa)

    def test_caddy_forwarding_and_vendor_exemption(self):
        """Funnel-adressen får inte kollapsa rate limitingen till en hink."""
        caddy = (ROOT / "Caddyfile").read_text(encoding="utf-8")
        self.assertIn("trusted_proxies", caddy)
        self.assertIn("header_up X-Real-IP {client_ip}", caddy)
        # @code får inte skriva över den hårda cachen för /vendor/*.js.
        code_block = re.search(r"@code \{(.*?)\}", caddy, re.S)
        self.assertIsNotNone(code_block)
        self.assertIn("not path /vendor/*", code_block.group(1))

    def test_repair_script_requires_a_puzzle_version_bump(self):
        repair = (ROOT / "pipeline" / "repair_splits.py").read_text(encoding="utf-8")
        self.assertIn("CHARTLE_ALLOW_INPLACE_REPAIR", repair)
        self.assertIn("PUZZLE_VERSION", repair)

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
