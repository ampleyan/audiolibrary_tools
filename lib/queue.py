"""
lib/queue.py
------------
Queue and result CSV management for yt_slsk.
Provides both a QueueManager class and standalone helper functions.
"""

import csv
import json
import re
from datetime import datetime
from pathlib import Path

ACTIVE_STATUSES = {"new", "retry", "needs_review"}

QUEUE_FIELDS  = ["artist", "title", "raw_title", "status", "source_url"]
RESULT_FIELDS = ["artist", "title", "raw_title", "date", "source_url"]


# ── Standalone helpers (also used by tests) ───────────────────────────────────

def clean_title(raw: str) -> tuple:
    """
    Clean a YouTube video title and split into (artist, title, status).

    Strips bracketed/parenthetical junk (Official Video, HD, 4K, etc.),
    trailing pipe labels, then splits on the first ' - '.

    Returns (artist, title, status) where status is 'new' or 'needs_review'.
    """
    # 1. Remove bracketed/parenthetical suffixes containing known noise words
    s = re.sub(
        r'[\[\(][^\[\(\]\)]*?'
        r'(official|lyric|hd|hq|4k|video|audio|free\s*download|320kbps)'
        r'[^\[\(\]\)]*?[\]\)]',
        '', raw, flags=re.I
    )
    # 2. Strip trailing pipe or double-slash labels  (| label, // label)
    s = re.sub(r'\s*[|/]{1,2}.*$', '', s)
    # 3. Strip bare trailing keywords
    s = re.sub(r'\s+(official\s*(video|audio)|hq|hd)\s*$', '', s, flags=re.I)
    # 4. Normalise whitespace
    s = re.sub(r'\s{2,}', ' ', s).strip()

    if ' - ' in s:
        parts = s.split(' - ', 1)
        return parts[0].strip(), parts[1].strip(), 'new'
    return '', s, 'needs_review'


def normalize_key(artist: str, title: str) -> str:
    """Lowercase + strip key used for log and result CSV deduplication."""
    if artist:
        return f"{artist} - {title}".lower().strip()
    return title.lower().strip()


def load_log(path) -> dict:
    """Load yt_slsk_log.json. Returns {} if absent or unreadable."""
    try:
        return json.loads(Path(path).read_bytes().decode('utf-8'))
    except Exception:
        return {}


def save_log(path, data: dict):
    """Save log dict to JSON (UTF-8)."""
    Path(path).write_bytes(
        json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8')
    )


def assign_queue_status(artist: str, title: str, log: dict) -> str:
    """
    Determine queue status for a track based on the persistent log.

    downloaded → 'skip'
    not_found / failed → 'retry'
    absent → 'new'
    """
    key = normalize_key(artist, title)
    entry = log.get(key)
    if not entry:
        return 'new'
    if entry.get('status') == 'downloaded':
        return 'skip'
    return 'retry'


def write_queue(path, rows: list):
    """Write queue rows (list of dicts) to CSV."""
    with open(path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=QUEUE_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def read_queue(path) -> list:
    """Read queue CSV. Returns [] if absent."""
    try:
        with open(path, newline='', encoding='utf-8') as f:
            return list(csv.DictReader(f))
    except FileNotFoundError:
        return []


def load_result_csv(path) -> dict:
    """
    Load a not_found or failed CSV into a dict keyed by normalized artist-title.
    Returns {} if absent.
    """
    try:
        with open(path, newline='', encoding='utf-8') as f:
            rows = list(csv.DictReader(f))
        return {normalize_key(r['artist'], r['title']): r for r in rows}
    except FileNotFoundError:
        return {}


def save_result_csv(path, rows: dict):
    """
    Write a result dict (keyed by normalized key) to CSV using a safe
    write (write to .tmp, then rename).
    """
    tmp = Path(path).with_suffix('.tmp')
    with open(tmp, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=RESULT_FIELDS)
        writer.writeheader()
        writer.writerows(rows.values())
    tmp.replace(path)


# ── QueueManager class ────────────────────────────────────────────────────────

class QueueManager:
    """High-level interface for the yt_slsk download queue and result files."""

    def __init__(self, queue_file: Path, not_found_file: Path, failed_file: Path):
        self.queue_file     = Path(queue_file)
        self.not_found_file = Path(not_found_file)
        self.failed_file    = Path(failed_file)

    def load(self) -> list:
        """Read all rows from queue CSV."""
        return read_queue(self.queue_file)

    def get_active(self) -> list:
        """Return rows whose status is in ACTIVE_STATUSES (excludes 'skip')."""
        return [r for r in self.load() if r['status'] in ACTIVE_STATUSES]

    def build_query(self, row: dict) -> str:
        """Build the sldl search query string for a queue row."""
        return f"{row['artist']} - {row['title']}" if row['artist'] else row['title']

    def write_results(self, results: dict, query_to_row: dict) -> tuple:
        """
        Classify pass1_results into not_found and failed rows, write both CSVs.

        results       — {safe_query: 'downloaded'|'not_found'|'failed'}
        query_to_row  — {safe_query: queue_row_dict}

        Returns (not_found_count, failed_count).
        """
        today = datetime.now().strftime('%Y-%m-%d')
        not_found_rows, failed_rows = [], []

        for safe_q, status in results.items():
            if status == 'downloaded':
                continue
            row = query_to_row.get(safe_q)
            if not row:
                continue
            entry = {
                'artist':    row['artist'],
                'title':     row['title'],
                'raw_title': row['raw_title'],
                'date':      today,
                'source_url': row.get('source_url', ''),
            }
            if status == 'not_found':
                not_found_rows.append(entry)
            else:
                failed_rows.append(entry)

        for path, data in [
            (self.not_found_file, not_found_rows),
            (self.failed_file,    failed_rows),
        ]:
            tmp = Path(path).with_suffix('.tmp')
            with open(tmp, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=RESULT_FIELDS)
                writer.writeheader()
                writer.writerows(data)
            tmp.replace(path)

        return len(not_found_rows), len(failed_rows)
