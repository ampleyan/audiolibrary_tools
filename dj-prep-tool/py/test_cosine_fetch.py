import importlib.util
import pathlib
import unittest


module_path = pathlib.Path(__file__).with_name("cosine_fetch.py")
spec = importlib.util.spec_from_file_location("cosine_fetch", module_path)
cosine_fetch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cosine_fetch)


class CosineFetchTests(unittest.TestCase):
    def test_serialized_track_is_safe_for_windows_code_pages(self):
        output = cosine_fetch.serialize_track({"title": "Fofucha Preparadá"})
        output.encode("ascii")
        self.assertIn("\\u0301", output)

    def test_similar_url_includes_discogs_filters(self):
        url = cosine_fetch.build_similar_url("123", {
            "yearStart": 1950,
            "yearEnd": 2026,
            "minHave": 0,
            "maxHave": 10000,
            "minWant": 0,
            "maxWant": 5000,
            "minPrice": 0,
            "maxPrice": 500,
        })

        self.assertEqual(
            url,
            "https://cosine.club/api/v1/tracks/123/similar?start=1950&end=2026&min_have=0&max_have=10000&min_want=0&max_want=5000&min_price=0&max_price=500",
        )

    def test_similar_url_includes_pagination(self):
        url = cosine_fetch.build_similar_url("123", {"page": 2, "limit": 20})
        self.assertEqual(url, "https://cosine.club/api/v1/tracks/123/similar?page=2&limit=20")


if __name__ == "__main__":
    unittest.main()
