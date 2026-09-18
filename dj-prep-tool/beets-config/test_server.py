import unittest

from server import build_import_args


class ImportArgsTests(unittest.TestCase):
    def test_import_args_omit_empty_nowrite_option(self):
        self.assertEqual(
            build_import_args("/music/inbox/track.mp3", False),
            ["import", "/music/inbox/track.mp3"],
        )
        self.assertEqual(
            build_import_args("/music/inbox/track.mp3", True),
            ["import", "--nowrite", "/music/inbox/track.mp3"],
        )


if __name__ == "__main__":
    unittest.main()
