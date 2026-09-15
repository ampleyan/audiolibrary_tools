import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server


class ConversionTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
