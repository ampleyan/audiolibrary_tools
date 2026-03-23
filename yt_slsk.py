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


def cmd_fetch(url: str):
    raise NotImplementedError("cmd_fetch not yet implemented")


def cmd_download():
    raise NotImplementedError("cmd_download not yet implemented")


def main():
    parser = argparse.ArgumentParser(description="YouTube -> Soulseek batch downloader")
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
