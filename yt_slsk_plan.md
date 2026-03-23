# YouTube → Soulseek Batch Downloader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `yt_slsk.py` — a standalone script that fetches YouTube playlist/channel track titles, cleans them, deduplicates against a persistent log, and downloads via slsk-batchdl with full status reporting.

**Architecture:** Two CLI phases (`--fetch` and `--download`) in a single script. `--fetch` calls yt-dlp for metadata only and writes a human-editable queue CSV. `--download` feeds that queue to slsk-batchdl, parses its output, and maintains persistent JSON log + not-found/failed CSVs.

**Tech Stack:** Python 3, `yt-dlp` (metadata extraction), `slsk-batchdl` (external CLI, not a Python package), `argparse`, `csv`, `json`, `subprocess`, `re`, `pathlib`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `yt_slsk.py` | Create | Main script: config, CLI, all logic |
| `README_yt_slsk.md` | Create | User-facing documentation |
| `requirements.txt` | Modify | Add `yt-dlp` |
| `tests/test_yt_slsk.py` | Create | Unit tests for pure functions |

All data files (`yt_slsk_queue.csv`, `yt_slsk_log.json`, `yt_slsk_not_found.csv`, `yt_slsk_failed.csv`) are created at runtime alongside `yt_slsk.py`.

---

## Task 1: Scaffold + config block + CLI

**Files:**
- Create: `yt_slsk.py`
- Modify: `requirements.txt`

- [ ] **Step 1: Add yt-dlp to requirements.txt**

Open `requirements.txt` and add `yt-dlp` on a new line.

- [ ] **Step 2: Create yt_slsk.py with config block and argparse skeleton**

```python
"""
yt_slsk.py
----------
Fetch track titles from a YouTube playlist or channel, clean them,
and download via slsk-batchdl.

Usage:
  python yt_slsk.py --fetch [url]   # fetch & write queue CSV
  python yt_slsk.py --download      # run slsk-batchdl on queue
"""

import argparse
import csv
import json
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

# ─── CONFIG ───────────────────────────────────────────────────────────────────

DRY_RUN         = True                      # set False to actually download
YOUTUBE_URL     = ""                        # default URL; overridden by --fetch <url>
SLSKD_CMD       = "slsk-batchdl"           # path or command name
QUEUE_FILE      = "yt_slsk_queue.csv"
LOG_FILE        = "yt_slsk_log.json"
NOT_FOUND_FILE  = "yt_slsk_not_found.csv"
FAILED_FILE     = "yt_slsk_failed.csv"
SLSK_OUTPUT_DIR = r"D:\MUSIC\TO PROCESS"   # passed to slsk-batchdl --output

# ──────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent


def main():
    parser = argparse.ArgumentParser(description="YouTube → Soulseek batch downloader")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--fetch", nargs="?", const="__use_config__", metavar="URL",
                       help="Fetch track list from YouTube URL")
    group.add_argument("--download", action="store_true",
                       help="Download tracks in queue via slsk-batchdl")
    args = parser.parse_args()

    if args.fetch is not None:
        url = args.fetch if args.fetch != "__use_config__" else YOUTUBE_URL
        if not url:
            print("ERROR: No URL provided. Pass a URL to --fetch or set YOUTUBE_URL in config.")
            sys.exit(1)
        cmd_fetch(url)
    elif args.download:
        cmd_download()


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Verify script runs and prints help**

```bash
python yt_slsk.py --help
```

Expected output includes `--fetch` and `--download` described.

- [ ] **Step 4: Commit**

```bash
git add yt_slsk.py requirements.txt
git commit -m "feat: scaffold yt_slsk.py with config block and CLI"
```

---

## Task 2: Title cleaning

**Files:**
- Modify: `yt_slsk.py`
- Create: `tests/test_yt_slsk.py`

- [ ] **Step 1: Create tests directory and write failing tests**

```bash
mkdir tests
```

Create `tests/test_yt_slsk.py`:

```python
import sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent.parent))
from yt_slsk import clean_title, normalize_key

def test_strips_bracketed_official_video():
    artist, title, status = clean_title("Surgeon - Magneze [Official Video] [HD]")
    assert artist == "Surgeon"
    assert title == "Magneze"
    assert status == "new"

def test_strips_parenthetical_official_audio():
    artist, title, status = clean_title("Ancient Methods - Stalker (Official Audio)")
    assert artist == "Ancient Methods"
    assert title == "Stalker"
    assert status == "new"

def test_clean_title_no_junk():
    artist, title, status = clean_title("Blawan - Getting Me Down")
    assert artist == "Blawan"
    assert title == "Getting Me Down"
    assert status == "new"

def test_needs_review_no_dash():
    artist, title, status = clean_title("Some Mix Without Dash")
    assert artist == ""
    assert title == "Some Mix Without Dash"
    assert status == "needs_review"

def test_strips_pipe_label():
    artist, title, status = clean_title("Vatican Shadow - Kneel Before Religious Icons | Hospital Productions")
    assert artist == "Vatican Shadow"
    assert title == "Kneel Before Religious Icons"
    assert status == "new"

def test_strips_4k_hq():
    artist, title, status = clean_title("Regis - Mutant Jazz [4K] HQ")
    assert artist == "Regis"
    assert title == "Mutant Jazz"
    assert status == "new"

def test_normalize_key_with_artist():
    assert normalize_key("Surgeon", "Magneze") == "surgeon - magneze"

def test_normalize_key_blank_artist():
    assert normalize_key("", "Some Mix") == "some mix"

if __name__ == "__main__":
    passed = failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            try:
                fn()
                print(f"  PASS  {name}")
                passed += 1
            except AssertionError as e:
                print(f"  FAIL  {name}: {e}")
                failed += 1
    print(f"\n{passed} passed, {failed} failed")
```

- [ ] **Step 2: Run tests — expect failures (functions not defined yet)**

```bash
python tests/test_yt_slsk.py
```

Expected: errors about `clean_title` not being importable.

- [ ] **Step 3: Implement clean_title() and normalize_key() in yt_slsk.py**

Add after the config block:

```python
# ─── JUNK PATTERNS ────────────────────────────────────────────────────────────

_BRACKET_JUNK = re.compile(
    r'[\[\(]'
    r'(?:official\s+(?:video|audio|music\s+video|lyric\s+video)|'
    r'lyrics?|hd|hq|4k|free\s+download|\d+\s*kbps|music\s+video)'
    r'[\]\)]',
    re.IGNORECASE
)
_PIPE_JUNK    = re.compile(r'\s*[|/]{1,2}\s+.+$')
_BARE_JUNK    = re.compile(r'\s+(?:official\s+(?:video|audio)|hq|hd)\s*$', re.IGNORECASE)


def clean_title(raw: str) -> tuple[str, str, str]:
    """Clean a YouTube title. Returns (artist, title, status)."""
    s = raw
    s = _BRACKET_JUNK.sub("", s)
    s = _PIPE_JUNK.sub("", s)
    s = _BARE_JUNK.sub("", s)
    s = re.sub(r"  +", " ", s).strip()

    if " - " in s:
        artist, title = s.split(" - ", 1)
        return artist.strip(), title.strip(), "new"
    return "", s.strip(), "needs_review"


def normalize_key(artist: str, title: str) -> str:
    """Produce a stable log key from artist + title."""
    if artist:
        return f"{artist} - {title}".lower().strip()
    return title.lower().strip()
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
python tests/test_yt_slsk.py
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add yt_slsk.py tests/test_yt_slsk.py
git commit -m "feat: add clean_title and normalize_key with tests"
```

---

## Task 3: Log and queue CSV helpers

**Files:**
- Modify: `yt_slsk.py`
- Modify: `tests/test_yt_slsk.py`

- [ ] **Step 1: Write failing tests for log and queue helpers**

Append to `tests/test_yt_slsk.py`:

```python
import json, csv, tempfile, os
from yt_slsk import load_log, save_log, assign_queue_status, write_queue, read_queue

def test_load_log_missing_file():
    assert load_log("/nonexistent/path.json") == {}

def test_save_and_load_log(tmp_path):
    path = str(tmp_path / "log.json")
    data = {"surgeon - magneze": {"status": "downloaded"}}
    save_log(path, data)
    assert load_log(path) == data

def test_assign_queue_status_new():
    log = {}
    assert assign_queue_status("surgeon", "magneze", log) == "new"

def test_assign_queue_status_skip():
    log = {"surgeon - magneze": {"status": "downloaded"}}
    assert assign_queue_status("surgeon", "magneze", log) == "skip"

def test_assign_queue_status_retry():
    log = {"surgeon - magneze": {"status": "not_found"}}
    assert assign_queue_status("surgeon", "magneze", log) == "retry"

def test_write_and_read_queue(tmp_path):
    path = str(tmp_path / "queue.csv")
    rows = [
        {"artist": "Surgeon", "title": "Magneze", "raw_title": "Surgeon - Magneze [HD]",
         "status": "new", "source_url": "https://yt.com/playlist?list=x"},
    ]
    write_queue(path, rows)
    result = read_queue(path)
    assert len(result) == 1
    assert result[0]["artist"] == "Surgeon"
    assert result[0]["status"] == "new"
```

- [ ] **Step 2: Run tests — expect failures**

```bash
python tests/test_yt_slsk.py
```

- [ ] **Step 3: Implement log and queue helpers in yt_slsk.py**

```python
# ─── LOG HELPERS ──────────────────────────────────────────────────────────────

QUEUE_FIELDS = ["artist", "title", "raw_title", "status", "source_url"]
CSV_FIELDS   = ["artist", "title", "raw_title", "date", "source_url"]


def load_log(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_log(path: str, log: dict) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(log, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def assign_queue_status(artist: str, title: str, log: dict) -> str:
    key = normalize_key(artist, title)
    entry = log.get(key)
    if entry is None:
        return "new"
    if entry["status"] == "downloaded":
        return "skip"
    return "retry"  # not_found or failed


# ─── QUEUE CSV HELPERS ────────────────────────────────────────────────────────

def write_queue(path: str, rows: list[dict]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=QUEUE_FIELDS)
        w.writeheader()
        w.writerows(rows)


def read_queue(path: str) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
python tests/test_yt_slsk.py
```

- [ ] **Step 5: Commit**

```bash
git add yt_slsk.py tests/test_yt_slsk.py
git commit -m "feat: add log and queue CSV helpers with tests"
```

---

## Task 4: yt-dlp metadata extraction

**Files:**
- Modify: `yt_slsk.py`

No unit tests for this function — it calls an external service. Manual verification in Step 3.

- [ ] **Step 1: Implement fetch_titles() in yt_slsk.py**

```python
# ─── YT-DLP ───────────────────────────────────────────────────────────────────

def fetch_titles(url: str) -> list[tuple[str, str]]:
    """Return list of (raw_title, source_url) from a YouTube playlist or channel.
    Uses yt-dlp flat extraction — no audio downloaded."""
    import yt_dlp

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
        "skip_download": True,
    }

    results = []
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        entries = info.get("entries") or [info]
        for entry in entries:
            title = entry.get("title") or ""
            video_url = entry.get("url") or entry.get("webpage_url") or url
            if title:
                results.append((title, video_url))
    return results
```

- [ ] **Step 2: Install yt-dlp**

```bash
pip install yt-dlp
```

- [ ] **Step 3: Manual smoke test**

```bash
python -c "from yt_slsk import fetch_titles; titles = fetch_titles('https://www.youtube.com/playlist?list=PLbZIPy20-1BN61hGeO1kFXtqOsTJkqp_A'); print(titles[:3])"
```

Expected: list of (title, url) tuples printed. (Any public playlist will do.)

- [ ] **Step 4: Commit**

```bash
git add yt_slsk.py
git commit -m "feat: add yt-dlp metadata extraction"
```

---

## Task 5: --fetch phase assembly

**Files:**
- Modify: `yt_slsk.py`

- [ ] **Step 1: Implement cmd_fetch() in yt_slsk.py**

```python
# ─── FETCH COMMAND ────────────────────────────────────────────────────────────

def cmd_fetch(url: str) -> None:
    print(f"Fetching titles from: {url}")
    raw_titles = fetch_titles(url)
    print(f"Found {len(raw_titles)} tracks from YouTube.")

    log = load_log(str(SCRIPT_DIR / LOG_FILE))

    rows = []
    for raw_title, source_url in raw_titles:
        artist, title, base_status = clean_title(raw_title)
        if base_status == "needs_review":
            status = "needs_review"
        else:
            status = assign_queue_status(artist, title, log)
        rows.append({
            "artist": artist,
            "title": title,
            "raw_title": raw_title,
            "status": status,
            "source_url": source_url,
        })

    counts = {s: sum(1 for r in rows if r["status"] == s)
              for s in ("new", "retry", "needs_review", "skip")}

    print(f"\n  new={counts['new']}  retry={counts['retry']}  "
          f"needs_review={counts['needs_review']}  skip={counts['skip']}")

    if DRY_RUN:
        print("\n[DRY RUN] Queue not written. Set DRY_RUN = False to save.")
        for r in rows:
            flag = "  " if r["status"] == "skip" else "->"
            label = f"{r['artist']} - {r['title']}" if r["artist"] else r["title"]
            print(f"  {flag} [{r['status']:12}] {label}")
        return

    queue_path = str(SCRIPT_DIR / QUEUE_FILE)
    write_queue(queue_path, rows)
    print(f"\nQueue written to {queue_path}")
    print("Review the file, fix needs_review rows, then run --download.")
```

- [ ] **Step 2: Smoke test --fetch in dry-run mode**

Set `DRY_RUN = True` and `YOUTUBE_URL = ""` in config, then:

```bash
python yt_slsk.py --fetch "https://www.youtube.com/playlist?list=PLbZIPy20-1BN61hGeO1kFXtqOsTJkqp_A"
```

Expected: prints track list with statuses, says "[DRY RUN] Queue not written."

- [ ] **Step 3: Smoke test --fetch writing queue**

Set `DRY_RUN = False`, run again. Verify `yt_slsk_queue.csv` is created with correct columns and at least one row.

- [ ] **Step 4: Commit**

```bash
git add yt_slsk.py
git commit -m "feat: implement --fetch phase"
```

---

## Task 6: Output parsing for slsk-batchdl

**Files:**
- Modify: `yt_slsk.py`
- Modify: `tests/test_yt_slsk.py`

- [ ] **Step 1: Write failing tests for parse_output_line()**

Append to `tests/test_yt_slsk.py`:

```python
from yt_slsk import parse_output_line

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
```

- [ ] **Step 2: Run tests — expect failures**

```bash
python tests/test_yt_slsk.py
```

- [ ] **Step 3: Implement parse_output_line() in yt_slsk.py**

```python
# ─── OUTPUT PARSING ───────────────────────────────────────────────────────────

_PAT_DOWNLOADED = re.compile(r'succeeded|downloaded', re.IGNORECASE)
_PAT_NOT_FOUND  = re.compile(r'not found|no results|failed to find', re.IGNORECASE)
_PAT_FAILED     = re.compile(r'error|exception|timed out|connection', re.IGNORECASE)


def parse_output_line(line: str) -> str:
    """Classify a single line of slsk-batchdl output."""
    if _PAT_DOWNLOADED.search(line):
        return "downloaded"
    if _PAT_NOT_FOUND.search(line):
        return "not_found"
    if _PAT_FAILED.search(line):
        return "failed"
    return "failed"  # unrecognized → treat as failed, caller should warn
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
python tests/test_yt_slsk.py
```

- [ ] **Step 5: Commit**

```bash
git add yt_slsk.py tests/test_yt_slsk.py
git commit -m "feat: add slsk-batchdl output parser with tests"
```

---

## Task 7: not-found/failed CSV safe rewrite helpers

**Files:**
- Modify: `yt_slsk.py`
- Modify: `tests/test_yt_slsk.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_yt_slsk.py`:

```python
from yt_slsk import load_result_csv, save_result_csv

def test_load_result_csv_missing():
    assert load_result_csv("/nonexistent.csv") == {}

def test_save_and_load_result_csv(tmp_path):
    path = str(tmp_path / "not_found.csv")
    rows = {
        "ancient methods - stalker": {
            "artist": "Ancient Methods", "title": "Stalker",
            "raw_title": "Ancient Methods - Stalker (Official Audio)",
            "date": "2026-03-23", "source_url": "https://yt.com/x"
        }
    }
    save_result_csv(path, rows)
    loaded = load_result_csv(path)
    assert "ancient methods - stalker" in loaded
    assert loaded["ancient methods - stalker"]["artist"] == "Ancient Methods"

def test_save_result_csv_removes_succeeded(tmp_path):
    path = str(tmp_path / "not_found.csv")
    rows = {
        "ancient methods - stalker": {"artist": "Ancient Methods", "title": "Stalker",
                                       "raw_title": "x", "date": "2026-03-23", "source_url": "y"},
        "surgeon - magneze": {"artist": "Surgeon", "title": "Magneze",
                               "raw_title": "y", "date": "2026-03-23", "source_url": "y"},
    }
    save_result_csv(path, rows)
    # Simulate Surgeon - Magneze succeeding: remove from rows before save
    del rows["surgeon - magneze"]
    save_result_csv(path, rows)
    loaded = load_result_csv(path)
    assert "surgeon - magneze" not in loaded
    assert "ancient methods - stalker" in loaded
```

- [ ] **Step 2: Run tests — expect failures**

```bash
python tests/test_yt_slsk.py
```

- [ ] **Step 3: Implement load_result_csv() and save_result_csv() in yt_slsk.py**

```python
# ─── RESULT CSV HELPERS ───────────────────────────────────────────────────────

def load_result_csv(path: str) -> dict:
    """Load a not_found or failed CSV into a dict keyed by normalize_key."""
    try:
        with open(path, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        return {normalize_key(r["artist"], r["title"]): r for r in rows}
    except FileNotFoundError:
        return {}


def save_result_csv(path: str, rows: dict) -> None:
    """Write a result CSV dict (keyed by normalize_key) to disk (safe write)."""
    tmp = path + ".tmp"
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        w.writerows(rows.values())
    os.replace(tmp, path)
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
python tests/test_yt_slsk.py
```

- [ ] **Step 5: Commit**

```bash
git add yt_slsk.py tests/test_yt_slsk.py
git commit -m "feat: add result CSV safe-write helpers with tests"
```

---

## Task 8: --download phase assembly

**Files:**
- Modify: `yt_slsk.py`

- [ ] **Step 1: Implement cmd_download() in yt_slsk.py**

```python
# ─── DOWNLOAD COMMAND ─────────────────────────────────────────────────────────

def cmd_download() -> None:
    if DRY_RUN:
        print("ERROR: DRY_RUN is True. Set DRY_RUN = False in config to download.")
        sys.exit(1)

    queue_path = str(SCRIPT_DIR / QUEUE_FILE)
    if not os.path.exists(queue_path):
        print(f"ERROR: Queue file not found: {queue_path}")
        print("Run --fetch first.")
        sys.exit(1)

    rows = read_queue(queue_path)
    active = [r for r in rows if r["status"] in ("new", "retry", "needs_review")]
    skipped = [r for r in rows if r["status"] == "skip"]

    if not active:
        print("Nothing to download (all tracks are skip or queue is empty).")
        return

    # Build temp input file
    tmp_input = str(SCRIPT_DIR / "_slsk_input.tmp")
    with open(tmp_input, "w", encoding="utf-8") as f:
        for r in active:
            query = f"{r['artist']} - {r['title']}" if r["artist"] else r["title"]
            f.write(query + "\n")

    print(f"Sending {len(active)} tracks to slsk-batchdl...")

    # Run slsk-batchdl
    cmd = [SLSKD_CMD, "--input", tmp_input, "--output", SLSK_OUTPUT_DIR, "--no-progress"]
    results = {r["status"]: [] for r in active}  # placeholder
    results = {"downloaded": [], "not_found": [], "failed": []}
    track_map = {}  # search_query_lower → queue row
    for r in active:
        query = f"{r['artist']} - {r['title']}" if r["artist"] else r["title"]
        track_map[query.lower()] = r

    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 text=True, encoding="utf-8", errors="replace")
        pending_idx = 0  # positional fallback counter
        for line in proc.stdout:
            line = line.rstrip()
            if not line:
                continue
            # Try echo-match first
            matched_row = None
            for query_lower, row in track_map.items():
                if query_lower in line.lower():
                    matched_row = row
                    break
            # Positional fallback
            if matched_row is None and pending_idx < len(active):
                matched_row = active[pending_idx]
                pending_idx += 1
            if matched_row is None:
                print(f"  [warn] unrecognized output line: {line}")
                continue

            status = parse_output_line(line)
            results[status].append(matched_row)

        proc.wait()
    except FileNotFoundError:
        print(f"ERROR: slsk-batchdl not found at '{SLSKD_CMD}'. Is it installed?")
        sys.exit(1)
    finally:
        if os.path.exists(tmp_input):
            os.remove(tmp_input)

    today = str(date.today())

    # Update log
    log = load_log(str(SCRIPT_DIR / LOG_FILE))
    for status, row_list in results.items():
        for r in row_list:
            key = normalize_key(r["artist"], r["title"])
            log[key] = {
                "artist": r["artist"], "title": r["title"],
                "raw_title": r["raw_title"], "status": status,
                "date": today, "source_url": r["source_url"],
            }
    save_log(str(SCRIPT_DIR / LOG_FILE), log)

    # Update not_found CSV
    nf = load_result_csv(str(SCRIPT_DIR / NOT_FOUND_FILE))
    for r in results["not_found"]:
        key = normalize_key(r["artist"], r["title"])
        nf[key] = {"artist": r["artist"], "title": r["title"],
                   "raw_title": r["raw_title"], "date": today, "source_url": r["source_url"]}
    for r in results["downloaded"]:
        nf.pop(normalize_key(r["artist"], r["title"]), None)
    save_result_csv(str(SCRIPT_DIR / NOT_FOUND_FILE), nf)

    # Update failed CSV
    fl = load_result_csv(str(SCRIPT_DIR / FAILED_FILE))
    for r in results["failed"]:
        key = normalize_key(r["artist"], r["title"])
        fl[key] = {"artist": r["artist"], "title": r["title"],
                   "raw_title": r["raw_title"], "date": today, "source_url": r["source_url"]}
    for r in results["downloaded"]:
        fl.pop(normalize_key(r["artist"], r["title"]), None)
    save_result_csv(str(SCRIPT_DIR / FAILED_FILE), fl)

    # Print report
    def fmt_list(row_list):
        names = [f"{r['artist']} - {r['title']}" if r["artist"] else r["title"]
                 for r in row_list]
        return ", ".join(names[:5]) + ("..." if len(names) > 5 else "")

    needs_review = [r for r in active if r["status"] == "needs_review"]
    print(f"\n{'DOWNLOADED':15} ({len(results['downloaded']):3}): {fmt_list(results['downloaded'])}")
    print(f"{'NOT FOUND':15} ({len(results['not_found']):3}): {fmt_list(results['not_found'])}")
    print(f"{'FAILED':15} ({len(results['failed']):3}): {fmt_list(results['failed'])}")
    print(f"{'SKIPPED':15} ({len(skipped):3}): already in log")
    print(f"{'NEEDS REVIEW':15} ({len(needs_review):3}): {fmt_list(needs_review)}")
```

- [ ] **Step 2: Smoke test --download dry-run guard**

Make sure `DRY_RUN = True` in config, then:

```bash
python yt_slsk.py --download
```

Expected: prints "ERROR: DRY_RUN is True..." and exits.

- [ ] **Step 3: Smoke test --download with no queue file**

With `DRY_RUN = False`, delete any existing queue file, then:

```bash
python yt_slsk.py --download
```

Expected: prints "Queue file not found..." and exits.

- [ ] **Step 4: Commit**

```bash
git add yt_slsk.py
git commit -m "feat: implement --download phase"
```

---

## Task 9: README

**Files:**
- Create: `README_yt_slsk.md`

- [ ] **Step 1: Create README_yt_slsk.md**

```markdown
# yt_slsk.py — YouTube → Soulseek Batch Downloader

Fetch track titles from a YouTube playlist or channel, clean them,
and download via slsk-batchdl.

## Requirements

```
pip install yt-dlp
```

Install slsk-batchdl: https://github.com/fiso64/slsk-batchdl

## Setup

Edit the config block at the top of `yt_slsk.py`:

| Setting | Description |
|---------|-------------|
| `DRY_RUN` | `True` = preview only, no writes. Set `False` to download. |
| `YOUTUBE_URL` | Default playlist/channel URL (can be passed via CLI instead) |
| `SLSKD_CMD` | Path or command name for slsk-batchdl |
| `SLSK_OUTPUT_DIR` | Where slsk-batchdl saves downloaded files |

## Commands

```bash
# Step 1 — fetch track list (dry run: preview only, no files written)
# Keep DRY_RUN = True, then:
python yt_slsk.py --fetch https://youtube.com/playlist?list=...

# Step 1 — fetch and write queue (set DRY_RUN = False first)
python yt_slsk.py --fetch https://youtube.com/playlist?list=...

# Step 1 — use the URL hardcoded in YOUTUBE_URL config
python yt_slsk.py --fetch

# Step 2 — review yt_slsk_queue.csv
# - Fix rows with status=needs_review (no "Artist - Title" format found)
# - Delete rows you don't want
# - Change status=skip to permanently suppress a track

# Step 3 — download (DRY_RUN must be False)
python yt_slsk.py --download
```

## Output Files

| File | Description |
|------|-------------|
| `yt_slsk_queue.csv` | Track queue — edit between fetch and download |
| `yt_slsk_log.json` | Persistent download history (prevents re-downloading) |
| `yt_slsk_not_found.csv` | Tracks not available on Soulseek |
| `yt_slsk_failed.csv` | Tracks that errored during download |

## Tips

- Re-run `--fetch` on the same URL anytime — already downloaded tracks are skipped automatically.
- To retry not-found tracks: open `yt_slsk_not_found.csv`, find the track, change its status to `retry` in `yt_slsk_queue.csv`, then run `--download` again.
- After downloading, run `organize_music.py` on `SLSK_OUTPUT_DIR` to sort files into your library.
```

- [ ] **Step 2: Verify the README renders correctly**

Open `README_yt_slsk.md` in any Markdown viewer and confirm code blocks and table display properly.

- [ ] **Step 3: Commit**

```bash
git add README_yt_slsk.md
git commit -m "docs: add README for yt_slsk.py"
```

---

## Task 10: End-to-end smoke test

No new files — verify the full flow works together.

- [ ] **Step 1: Run all unit tests**

```bash
python tests/test_yt_slsk.py
```

Expected: all PASS.

- [ ] **Step 2: Full dry-run fetch with a real playlist**

Set `DRY_RUN = True` in config. Run:

```bash
python yt_slsk.py --fetch "https://www.youtube.com/playlist?list=PLbZIPy20-1BN61hGeO1kFXtqOsTJkqp_A"
```

Expected: prints track list with statuses (all `new` on first run), says "[DRY RUN] Queue not written."

- [ ] **Step 3: Real fetch writing queue**

Set `DRY_RUN = False`. Run same command. Verify `yt_slsk_queue.csv` exists with correct rows.

- [ ] **Step 4: Re-fetch same URL — verify dedup**

Run `--fetch` again on the same URL. Expected: all tracks are now `skip` (not in log yet → `new`, but this step confirms dedup doesn't error; actual `skip` behavior kicks in after a successful `--download`).

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat: complete yt_slsk.py implementation"
```
