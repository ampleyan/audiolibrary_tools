import importlib.util
import pathlib
import unittest


module_path = pathlib.Path(__file__).with_name("telegram_fetch.py")
spec = importlib.util.spec_from_file_location("telegram_fetch", module_path)
telegram_fetch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(telegram_fetch)


class TelegramFetchTests(unittest.TestCase):
    def test_extracts_supported_youtube_urls_and_deduplicates(self):
        text = (
            "https://www.youtube.com/watch?v=abc123&t=30\n"
            "https://youtu.be/short456\n"
            "https://www.youtube.com/shorts/short789\n"
            "https://www.youtube.com/playlist?list=PL123\n"
            "https://youtu.be/short456"
        )
        self.assertEqual(
            telegram_fetch.extract_youtube_urls(text),
            [
                "https://www.youtube.com/watch?v=abc123",
                "https://youtu.be/short456",
                "https://www.youtube.com/shorts/short789",
                "https://www.youtube.com/playlist?list=PL123",
            ],
        )

    def test_ignores_non_youtube_text_and_message_urls(self):
        self.assertEqual(
            telegram_fetch.extract_youtube_urls(
                "Listen https://example.com/a and https://t.me/c/2508065505/42"
            ),
            [],
        )


if __name__ == "__main__":
    unittest.main()
