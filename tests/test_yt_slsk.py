import sys, os, json, csv, tempfile
sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent.parent))
from yt_slsk import (
    clean_title, normalize_key,
    load_log, save_log, assign_queue_status,
    write_queue, read_queue,
    load_result_csv, save_result_csv,
    parse_output_line,
)

# ─── clean_title ──────────────────────────────────────────────────────────────

def test_strips_bracketed_official_video():
    a, t, s = clean_title("Surgeon - Magneze [Official Video] [HD]")
    assert a == "Surgeon" and t == "Magneze" and s == "new"

def test_strips_parenthetical_official_audio():
    a, t, s = clean_title("Ancient Methods - Stalker (Official Audio)")
    assert a == "Ancient Methods" and t == "Stalker" and s == "new"

def test_clean_title_no_junk():
    a, t, s = clean_title("Blawan - Getting Me Down")
    assert a == "Blawan" and t == "Getting Me Down" and s == "new"

def test_needs_review_no_dash():
    a, t, s = clean_title("Some Mix Without Dash")
    assert a == "" and t == "Some Mix Without Dash" and s == "needs_review"

def test_strips_pipe_label():
    a, t, s = clean_title("Vatican Shadow - Kneel Before Religious Icons | Hospital Productions")
    assert a == "Vatican Shadow" and t == "Kneel Before Religious Icons" and s == "new"

def test_strips_4k():
    a, t, s = clean_title("Regis - Mutant Jazz [4K]")
    assert a == "Regis" and t == "Mutant Jazz" and s == "new"

# ─── normalize_key ────────────────────────────────────────────────────────────

def test_normalize_key_with_artist():
    assert normalize_key("Surgeon", "Magneze") == "surgeon - magneze"

def test_normalize_key_blank_artist():
    assert normalize_key("", "Some Mix") == "some mix"

# ─── log helpers ──────────────────────────────────────────────────────────────

def test_load_log_missing_file():
    assert load_log("/nonexistent/path.json") == {}

def test_save_and_load_log():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "log.json")
        data = {"surgeon - magneze": {"status": "downloaded"}}
        save_log(path, data)
        assert load_log(path) == data

def test_assign_queue_status_new():
    assert assign_queue_status("surgeon", "magneze", {}) == "new"

def test_assign_queue_status_skip():
    log = {"surgeon - magneze": {"status": "downloaded"}}
    assert assign_queue_status("surgeon", "magneze", log) == "skip"

def test_assign_queue_status_retry():
    log = {"surgeon - magneze": {"status": "not_found"}}
    assert assign_queue_status("surgeon", "magneze", log) == "retry"

# ─── queue CSV ────────────────────────────────────────────────────────────────

def test_write_and_read_queue():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "queue.csv")
        rows = [{"artist": "Surgeon", "title": "Magneze", "raw_title": "Surgeon - Magneze [HD]",
                 "status": "new", "source_url": "https://yt.com/x"}]
        write_queue(path, rows)
        result = read_queue(path)
        assert len(result) == 1
        assert result[0]["artist"] == "Surgeon"
        assert result[0]["status"] == "new"

# ─── result CSV ───────────────────────────────────────────────────────────────

def test_load_result_csv_missing():
    assert load_result_csv("/nonexistent.csv") == {}

def test_save_and_load_result_csv():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "not_found.csv")
        rows = {"ancient methods - stalker": {
            "artist": "Ancient Methods", "title": "Stalker",
            "raw_title": "Ancient Methods - Stalker (Official Audio)",
            "date": "2026-03-23", "source_url": "https://yt.com/x"
        }}
        save_result_csv(path, rows)
        loaded = load_result_csv(path)
        assert "ancient methods - stalker" in loaded
        assert loaded["ancient methods - stalker"]["artist"] == "Ancient Methods"

def test_save_result_csv_removes_succeeded():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "not_found.csv")
        rows = {
            "ancient methods - stalker": {"artist": "Ancient Methods", "title": "Stalker",
                                          "raw_title": "x", "date": "2026-03-23", "source_url": "y"},
            "surgeon - magneze": {"artist": "Surgeon", "title": "Magneze",
                                  "raw_title": "y", "date": "2026-03-23", "source_url": "y"},
        }
        save_result_csv(path, rows)
        del rows["surgeon - magneze"]
        save_result_csv(path, rows)
        loaded = load_result_csv(path)
        assert "surgeon - magneze" not in loaded
        assert "ancient methods - stalker" in loaded

# ─── output parsing ───────────────────────────────────────────────────────────

def test_parse_succeeded():
    assert parse_output_line("Succeeded: Surgeon - Magneze") == "downloaded"

def test_parse_downloaded():
    assert parse_output_line("downloaded Blawan - Getting Me Down") == "downloaded"

def test_parse_not_found():
    assert parse_output_line("Not found: Ancient Methods - Stalker") == "not_found"

def test_parse_no_results():
    assert parse_output_line("No results for Vatican Shadow") == "not_found"

def test_parse_error():
    assert parse_output_line("Error: connection refused") == "failed"

def test_parse_timeout():
    assert parse_output_line("Timed out waiting for results") == "failed"

def test_parse_unknown():
    assert parse_output_line("some random line with no keywords") == "failed"

# ─── runner ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    passed = failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            try:
                fn()
                print(f"  PASS  {name}")
                passed += 1
            except Exception as e:
                print(f"  FAIL  {name}: {e}")
                failed += 1
    print(f"\n{passed} passed, {failed} failed")
    if failed:
        sys.exit(1)
