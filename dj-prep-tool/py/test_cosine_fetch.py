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


if __name__ == "__main__":
    unittest.main()
