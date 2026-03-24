"""
yt_slsk.py
----------
YouTube Playlist → Soulseek Batch Downloader.

Usage:
    python scripts/yt_slsk.py --fetch [URL]
    python scripts/yt_slsk.py --download

See README_yt_slsk.md for full workflow documentation.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import argparse
import os
import re
import shutil

import config
from lib.audio import AudioAnalyzer
from lib.downloader import SoulseekDownloader
from lib.queue import (
    QueueManager, clean_title, write_queue,
    QUEUE_FIELDS,
)


# ── Derived paths from config ─────────────────────────────────────────────────

QUEUE_FILE    = config.DATA_DIR / "yt_slsk_queue.csv"
NOT_FOUND_FILE = config.DATA_DIR / "yt_slsk_not_found.csv"
FAILED_FILE   = config.DATA_DIR / "yt_slsk_failed.csv"
SUMMARY_FILE  = config.DATA_DIR / "yt_slsk_summary.txt"


# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_fetch(url: str):
    import yt_dlp
    from datetime import datetime

    print(f"\n>>> Fetching YouTube Metadata from: {url}")
    rows = []

    ydl_opts = {"quiet": True, "extract_flat": False, "ignoreerrors": True}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info    = ydl.extract_info(url, download=False)
        entries = info.get("entries", [info])

        for entry in entries:
            if not entry:
                continue
            raw_title = entry.get("title", "")
            a, t, s   = clean_title(raw_title)

            # Fallback: try YouTube Art Track description for artist name
            if not a:
                desc = entry.get("description", "")
                if desc and " · " in desc:
                    for line in desc.splitlines():
                        if " · " in line and "Provided to YouTube" not in line:
                            meta_parts = line.split(" · ")
                            if len(meta_parts) >= 2:
                                a, s = meta_parts[1].strip(), "new"
                                break

            rows.append({
                "artist":    a,
                "title":     t,
                "raw_title": raw_title,
                "status":    s,
                "source_url": entry.get("webpage_url"),
            })

    config.DATA_DIR.mkdir(exist_ok=True)
    write_queue(QUEUE_FILE, rows)
    print(f">>> Successfully queued {len(rows)} tracks to {QUEUE_FILE.name}")


def cmd_download():
    from datetime import datetime

    if not QUEUE_FILE.exists():
        return print("Error: No queue file found. Run with --fetch first.")

    qm = QueueManager(QUEUE_FILE, NOT_FOUND_FILE, FAILED_FILE)
    dl = SoulseekDownloader(config.SLSKD_CMD, config.SLSK_OUTPUT_DIR, config.DATA_DIR)

    active = qm.get_active()
    if not active:
        return print("Nothing to download (all rows are status=skip).")

    queries      = [qm.build_query(r) for r in active]
    query_to_row = {q.replace('"', ''): r for q, r in zip(queries, active)}

    # PASS 1 — quality preference (FLAC / MP3 320 from sldl.conf)
    pass1_results = dl.run(queries, label="PASS 1: INITIAL")

    print("\n>>> Analyzing Download Integrity...")
    os.makedirs(config.REVIEW_DIR, exist_ok=True)

    summary       = {"lossless": [], "fakes": [], "mp3": []}
    retry_queries = []
    analyzer      = AudioAnalyzer()

    for root, _, files in os.walk(config.SLSK_OUTPUT_DIR):
        if "_NEEDS_REVIEW" in root:
            continue
        for fname in files:
            file_path = os.path.join(root, fname)
            if fname.lower().endswith(".flac"):
                if analyzer.is_real_flac(file_path):
                    summary["lossless"].append(fname)
                else:
                    print(f"  [!] Fake Detected: {fname} (Moved to _NEEDS_REVIEW)")
                    shutil.move(file_path, os.path.join(config.REVIEW_DIR, fname))
                    summary["fakes"].append(fname)
                    retry_queries.append(os.path.splitext(fname)[0])
            elif fname.lower().endswith(".mp3"):
                summary["mp3"].append(fname)

    # PASS 2 — retry fakes with fast-search fallback
    if retry_queries:
        print(f"\n>>> Retrying {len(retry_queries)} tracks for fallback quality...")
        dl.run(retry_queries, label="PASS 2: FALLBACK", fast_search=True)

    # Write not_found / failed CSVs
    config.DATA_DIR.mkdir(exist_ok=True)
    not_found_count, failed_count = qm.write_results(pass1_results, query_to_row)

    # Write summary report
    with open(SUMMARY_FILE, "w", encoding="utf-8") as f:
        f.write(f"SOULSEEK DOWNLOAD SUMMARY - {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
        f.write("=" * 60 + "\n\n")
        f.write(f"✓ VERIFIED LOSSLESS (FLAC): {len(summary['lossless'])}\n")
        for item in summary["lossless"]:
            f.write(f"  [L] {item}\n")
        f.write(f"\n⚠ FAKE LOSSLESS (MOVED TO REVIEW): {len(summary['fakes'])}\n")
        for item in summary["fakes"]:
            f.write(f"  [F] {item}\n")
        f.write(f"\n♫ RECOVERED AS MP3 / PRE-EXISTING: {len(summary['mp3'])}\n")
        for item in summary["mp3"]:
            f.write(f"  [M] {item}\n")
        f.write(f"\n✗ NOT FOUND ON SOULSEEK: {not_found_count}\n")
        f.write(f"\n! FAILED (ERROR): {failed_count}\n")

    print(f"\n>>> Not found : {not_found_count:>3}  → {NOT_FOUND_FILE.name}")
    print(f">>> Failed    : {failed_count:>3}  → {FAILED_FILE.name}")
    print(f">>> Process Complete. Report saved to: {SUMMARY_FILE}")
    if os.name == 'nt':
        os.startfile(SUMMARY_FILE)


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="YouTube Playlist → Soulseek Downloader")
    group  = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--fetch",    nargs="?", const="__use_config__",
                       help="Fetch YouTube metadata (optionally pass a URL)")
    group.add_argument("--download", action="store_true",
                       help="Run Soulseek download and analysis")
    args = parser.parse_args()

    if args.fetch:
        url = config.YOUTUBE_URL if args.fetch == "__use_config__" else args.fetch
        cmd_fetch(url)
    elif args.download:
        cmd_download()


if __name__ == "__main__":
    main()
