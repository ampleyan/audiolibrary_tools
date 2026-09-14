import importlib.util
import os
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = ROOT / "dj-prep-tool" / "web" / "server.py"


class WebSmokeTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        os.environ["DJ_PREP_DATA_DIR"] = self.temp_dir.name
        os.environ["DJ_PREP_INBOX_DIR"] = self.temp_dir.name
        os.environ["DJ_PREP_ARCHIVE_DIR"] = self.temp_dir.name
        spec = importlib.util.spec_from_file_location("dj_prep_web_smoke", SERVER_PATH)
        self.server = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.server)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_import_duplicate_activity_backup_restore_and_validation(self):
        first = self.server.insert(("Artist", "Title", None, None, "requested", None))
        duplicate = self.server.insert(("artist", "title", None, None, "requested", None))
        self.assertIn("duplicate of existing track", duplicate["error"])

        self.server.update(first["id"], "UPDATE tracks SET state=? WHERE id=?", ("matched",))
        activity = self.server.command("list_activity", {"limit": 10})[0]
        self.assertEqual(activity["fromState"], "requested")
        self.assertEqual(activity["toState"], "matched")

        backup = self.server.command("backup_database", {})
        self.server.insert(("Extra", "Track", None, None, "requested", None))
        self.server.command("restore_database", {"backupName": Path(backup).name})
        self.assertEqual(len(self.server.tracks()), 2)

        checks = self.server.command("validate_setup", {})
        self.assertTrue(next(check["ok"] for check in checks if check["name"] == "Prep inbox"))
        self.assertTrue(any(check["name"] == "Free storage" for check in checks))


if __name__ == "__main__":
    unittest.main()
