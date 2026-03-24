"""
lib/downloader.py
-----------------
Soulseek batch download wrapper around sldl.exe.
"""

import os
import re
import subprocess
from pathlib import Path


def parse_output_line(line: str) -> str:
    """
    Classify a single sldl output line into a download status string.

    Returns: 'downloaded' | 'not_found' | 'failed'
    """
    s = line.strip()
    if re.search(r'\bSucceeded\b|\bdownloaded\b', s, re.I):
        return 'downloaded'
    if re.search(r'Not found|no results|failed to find', s, re.I):
        return 'not_found'
    if re.search(r'\berror\b|\bexception\b|timed out|\bconnection\b', s, re.I):
        return 'failed'
    return 'failed'


class SoulseekDownloader:
    """
    Wraps sldl.exe for batch Soulseek downloads with real-time output parsing.

    Writes a temporary quoted list file, shells out to sldl via Popen,
    streams output to the terminal while parsing per-track status, then
    cleans up the temp file.
    """

    def __init__(self, sldl_cmd: str, output_dir: str, tmp_dir: Path):
        self._cmd      = sldl_cmd
        self._out_dir  = output_dir
        self._tmp_dir  = Path(tmp_dir)
        self._exe_dir  = Path(sldl_cmd).parent

    def run(self, queries: list, label: str = "PASS", fast_search: bool = False) -> dict:
        """
        Download a list of search queries via sldl.

        Queries must be strings like "Artist - Title" or just "Title".
        Each is written as a quoted line to a temp list file.
        Embedded double-quotes are stripped to avoid breaking the list format.

        Returns a dict mapping safe_query → 'downloaded' | 'not_found' | 'failed'.
        """
        tmp_input = self._tmp_dir / "_slsk_queries.tmp"
        with open(tmp_input, "w", encoding="utf-8") as f:
            for q in queries:
                # sldl list format uses whitespace as a column separator, so
                # queries must be quoted. Strip inner " to avoid breaking quoting.
                safe_q = q.replace('"', '')
                f.write(f'"{safe_q}"\n')

        print(f"\n>>> [Soulseek {label}] Processing {len(queries)} tracks...")

        cmd = [
            self._cmd,
            "--input", str(tmp_input),
            "--input-type", "list",
            "--path", self._out_dir,
            "--no-progress",
        ]
        if fast_search:
            cmd.append("--fast-search")

        results = {}        # safe_query → status
        current_query = None

        try:
            # cwd=exe_dir ensures sldl finds sldl.conf in its own directory
            proc = subprocess.Popen(
                cmd, cwd=str(self._exe_dir),
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace",
            )
            for line in proc.stdout:
                print(line, end="", flush=True)
                s = line.strip()

                # Use re.search (not match) — lines may carry timestamp prefixes
                m = re.search(r"Searching:\s+(.+)", s)
                if m:
                    current_query = m.group(1).strip()
                    results.setdefault(current_query, "not_found")
                elif current_query:
                    if re.search(r"\bSucceeded\b", s, re.I):
                        results[current_query] = "downloaded"
                    elif re.search(r"\bInitialize\b", s, re.I):
                        # sldl found a file and started downloading.
                        # Upgrade from not_found → failed (Succeeded will override).
                        if results.get(current_query) == "not_found":
                            results[current_query] = "failed"
                    elif re.search(r"All downloads failed:", s, re.I):
                        if results.get(current_query) != "downloaded":
                            results[current_query] = "failed"
            proc.wait()
        finally:
            if tmp_input.exists():
                os.remove(tmp_input)

        return results
