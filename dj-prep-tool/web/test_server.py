import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server


class ConversionTests(unittest.TestCase):
    def test_cosine_command_passes_filters_as_json(self):
        command = server.cosine_fetch_command("Artist", "Title", {
            "yearStart": 1950,
            "yearEnd": 2026,
            "minHave": 0,
            "maxHave": 10000,
            "minWant": 0,
            "maxWant": 5000,
            "minPrice": 0,
            "maxPrice": 500,
        })

        self.assertEqual(command[:3], [server.PYTHON, str(server.ROOT / "py" / "cosine_fetch.py"), "Artist"])
        self.assertEqual(command[3], "Title")
        self.assertEqual(json.loads(command[4])["maxWant"], 5000)

    def test_safe_audio_stem_removes_path_characters(self):
        self.assertEqual(server.safe_audio_stem("A/B", "Track: One"), "A B - Track One")

    def test_convert_to_mp3_uses_ffmpeg_and_returns_output(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "download.flac"
            source.write_bytes(b"flac")

            def fake_run(args, **kwargs):
                Path(args[-1]).write_bytes(b"mp3")
                return type("Result", (), {"returncode": 0, "stderr": ""})()

            with patch.object(server, "setting", return_value="ffmpeg"), patch.object(server.subprocess, "run", side_effect=fake_run):
                output = server.convert_to_mp3(str(source), "A/B", "Track: One")

            self.assertEqual(Path(output).name, "A B - Track One.mp3")
            self.assertTrue(Path(output).is_file())


class DownloadDiscoveryTests(unittest.TestCase):
    def test_aggregate_download_state_prioritizes_failure_then_progress(self):
        self.assertEqual(server.aggregate_download_state(["downloading", "failed"]), "failed")
        self.assertEqual(server.aggregate_download_state(["queued", "downloading"]), "downloading")
        self.assertEqual(server.aggregate_download_state(["downloaded", "downloaded"]), "downloaded")

    def test_finds_completed_download_in_nested_inbox_folder(self):
        with tempfile.TemporaryDirectory() as directory:
            downloaded = Path(directory) / "Artist" / "Album" / "track.flac"
            downloaded.parent.mkdir(parents=True)
            downloaded.write_bytes(b"flac")

            found = server.find_download_file(Path(directory), "track.flac")

            self.assertEqual(found, downloaded)

    def test_reads_partial_download_progress(self):
        with tempfile.TemporaryDirectory() as directory:
            partial = Path(directory) / "track.flac.part"
            partial.write_bytes(b"partial")

            progress = server.download_file_progress(Path(directory), "track.flac", 100)

            self.assertEqual(progress, {"bytesOnDisk": 7, "bytesTotal": 100, "complete": False})

    def test_normalizes_windows_download_paths(self):
        self.assertEqual(server.download_basename(r"@@txlen\Music\folder\track.mp3"), "track.mp3")


if __name__ == "__main__":
    unittest.main()
