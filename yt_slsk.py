import argparse
import csv
import os
import re
import subprocess
import shutil
import sys
from datetime import datetime
from pathlib import Path
import numpy as np
from scipy.fft import fft

# ─── CONFIGURATION ────────────────────────────────────────────────────────────
# Ensure these paths match your environment
YOUTUBE_URL = "https://youtube.com/playlist?list=PLbGg3INHWHkzX9G_J3XxDtKw3KoACjMnS"
SLSKD_CMD = r"C:\Users\ample\Documents\workspace\projects\audiolibrary_tools\sldl\sldl.exe"
SLSK_OUTPUT_DIR = r"D:\MUSIC\TO PROCESS"

# Derived Paths
SCRIPT_DIR = Path(__file__).parent
QUEUE_FILE = SCRIPT_DIR / "yt_slsk_queue.csv"
SUMMARY_FILE = SCRIPT_DIR / "yt_slsk_summary.txt"
NOT_FOUND_FILE = SCRIPT_DIR / "yt_slsk_not_found.csv"
FAILED_FILE = SCRIPT_DIR / "yt_slsk_failed.csv"
REVIEW_DIR = os.path.join(SLSK_OUTPUT_DIR, "_NEEDS_REVIEW")
QUEUE_FIELDS = ["artist", "title", "raw_title", "status", "source_url"]
RESULT_FIELDS = ["artist", "title", "raw_title", "date", "source_url"]


# ─── QUALITY ANALYSIS (FFT SPECTRAL CHECK) ────────────────────────────────────

def is_real_flac(file_path):
    """
    Analyzes frequency energy above 19kHz to detect upscaled MP3s (Fake FLACs).
    """
    try:
        # Extract 5 seconds from 45s mark to avoid intro silence
        cmd = [
            'ffmpeg', '-hide_banner', '-loglevel', 'error',
            '-i', file_path, '-ss', '45', '-t', '5',
            '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'
        ]
        process = subprocess.run(cmd, capture_output=True, check=True)
        audio_data = np.frombuffer(process.stdout, dtype=np.float32)

        if len(audio_data) == 0:
            return True  # Fallback to True if segment is unreadable

        spectrum = np.abs(fft(audio_data))
        freqs = np.linspace(0, 44100, len(spectrum))

        # Calculate ratio of High Freq (19k-22k) vs Audible Mid-Range (5k-15k)
        high_energy = np.sum(spectrum[(freqs > 19000) & (freqs < 22050)])
        low_energy = np.sum(spectrum[(freqs > 5000) & (freqs < 15000)])

        if low_energy == 0:
            return True

        # 0.001 is the standard threshold for presence of high-frequency data
        return (high_energy / low_energy) > 0.001
    except Exception as e:
        print(f"      [!] FFT Analysis Failed for {os.path.basename(file_path)}: {e}")
        return True


# ─── SOULSEEK EXECUTION ───────────────────────────────────────────────────────

def run_sldl(queries, label="PASS", fast_search=False):
    """Runs sldl using a temporary list file for query batching.

    Returns a dict mapping safe_query -> 'downloaded' | 'not_found' | 'failed'.
    Output is printed to the terminal in real-time while being parsed.
    """
    tmp_input = SCRIPT_DIR / "_slsk_queries.tmp"
    with open(tmp_input, "w", encoding="utf-8") as f:
        for q in queries:
            # Queries must be quoted — list format uses whitespace as column separator,
            # so an unquoted "Artist - Title" is parsed as input=Artist, condition="-".
            # Strip embedded double quotes to avoid breaking the quoted string.
            safe_q = q.replace('"', '')
            f.write(f'"{safe_q}"\n')

    exe_dir = os.path.dirname(SLSKD_CMD)
    print(f"\n>>> [Soulseek {label}] Processing {len(queries)} tracks...")

    cmd = [
        SLSKD_CMD,
        "--input", str(tmp_input),
        "--input-type", "list",
        "--path", SLSK_OUTPUT_DIR,
        "--no-progress"
    ]
    if fast_search:
        cmd.append("--fast-search")

    results = {}   # safe_query -> status
    current_query = None

    try:
        # cwd=exe_dir is the "magic" that makes sldl find your sldl.conf
        proc = subprocess.Popen(
            cmd, cwd=exe_dir,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace"
        )
        for line in proc.stdout:
            print(line, end="", flush=True)
            s = line.strip()
            # Use re.search (not match) — sldl lines may be prefixed with timestamps
            m = re.search(r"Searching:\s+(.+)", s)
            if m:
                current_query = m.group(1).strip()
                results.setdefault(current_query, "not_found")
            elif current_query:
                if re.search(r"\bSucceeded\b", s, re.I):
                    results[current_query] = "downloaded"
                elif re.search(r"\bInitialize\b", s, re.I):
                    # sldl found a file and started a download attempt.
                    # Upgrade from not_found → failed; Succeeded later will upgrade to downloaded.
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


# ─── WORKFLOW COMMANDS ────────────────────────────────────────────────────────

def cmd_download():
    if not QUEUE_FILE.exists():
        return print("Error: No queue file found. Run with --fetch first.")

    with open(QUEUE_FILE, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    active = [r for r in rows if r['status'] in ('new', 'retry', 'needs_review')]
    queries = [f"{r['artist']} - {r['title']}" if r['artist'] else r['title'] for r in active]

    # Map safe_query -> original row for result classification
    query_to_row = {q.replace('"', ''): r for q, r in zip(queries, active)}

    # PASS 1: The Quality Hunt (FLAC/320 Preferences from .conf)
    pass1_results = run_sldl(queries, label="PASS 1: INITIAL")

    print("\n>>> Analyzing Download Integrity...")
    os.makedirs(REVIEW_DIR, exist_ok=True)

    summary = {"lossless": [], "fakes": [], "mp3": []}
    retry_queries = []

    # Iterate through download folder (excluding the review folder)
    for root, _, files in os.walk(SLSK_OUTPUT_DIR):
        if "_NEEDS_REVIEW" in root: continue
        for file in files:
            file_path = os.path.join(root, file)
            if file.lower().endswith(".flac"):
                if is_real_flac(file_path):
                    summary["lossless"].append(file)
                else:
                    print(f"  [!] Fake Detected: {file} (Moved to _NEEDS_REVIEW)")
                    shutil.move(file_path, os.path.join(REVIEW_DIR, file))
                    summary["fakes"].append(file)
                    retry_queries.append(os.path.splitext(file)[0])
            elif file.lower().endswith(".mp3"):
                summary["mp3"].append(file)

    # PASS 2: Automatic Retry for Fakes/Missing
    if retry_queries:
        print(f"\n>>> Retrying {len(retry_queries)} tracks for fallback quality...")
        run_sldl(retry_queries, label="PASS 2: FALLBACK", fast_search=True)

    # WRITE NOT-FOUND / FAILED CSV FILES
    today = datetime.now().strftime('%Y-%m-%d')
    not_found_rows, failed_rows = [], []
    for safe_q, status in pass1_results.items():
        if status == "downloaded":
            continue
        row = query_to_row.get(safe_q)
        if not row:
            continue
        entry = {
            "artist": row["artist"], "title": row["title"],
            "raw_title": row["raw_title"], "date": today,
            "source_url": row.get("source_url", "")
        }
        (not_found_rows if status == "not_found" else failed_rows).append(entry)

    for path, data in [(NOT_FOUND_FILE, not_found_rows), (FAILED_FILE, failed_rows)]:
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=RESULT_FIELDS)
            writer.writeheader()
            writer.writerows(data)
        tmp.replace(path)

    # GENERATE SUMMARY REPORT
    with open(SUMMARY_FILE, "w", encoding="utf-8") as f:
        f.write(f"SOULSEEK DOWNLOAD SUMMARY - {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
        f.write("=" * 60 + "\n\n")
        f.write(f"✓ VERIFIED LOSSLESS (FLAC): {len(summary['lossless'])}\n")
        for item in summary["lossless"]: f.write(f"  [L] {item}\n")

        f.write(f"\n⚠ FAKE LOSSLESS (MOVED TO REVIEW): {len(summary['fakes'])}\n")
        for item in summary["fakes"]: f.write(f"  [F] {item}\n")

        f.write(f"\n♫ RECOVERED AS MP3 / PRE-EXISTING: {len(summary['mp3'])}\n")
        for item in summary["mp3"]: f.write(f"  [M] {item}\n")

        f.write(f"\n✗ NOT FOUND ON SOULSEEK: {len(not_found_rows)}\n")
        for r in not_found_rows: f.write(f"  [N] {r['artist']} - {r['title']}\n")

        f.write(f"\n! FAILED (ERROR): {len(failed_rows)}\n")
        for r in failed_rows: f.write(f"  [E] {r['artist']} - {r['title']}\n")

    print(f"\n>>> Not found : {len(not_found_rows):>3}  → {NOT_FOUND_FILE.name}")
    print(f">>> Failed    : {len(failed_rows):>3}  → {FAILED_FILE.name}")
    print(f">>> Process Complete. Report saved to: {SUMMARY_FILE}")
    # Automatically open the report for review
    os.startfile(SUMMARY_FILE) if os.name == 'nt' else None


def cmd_fetch(url):
    import yt_dlp
    print(f"\n>>> Fetching YouTube Metadata from: {url}")
    rows = []

    # extract_flat: False allows us to parse descriptions for official artist tags
    ydl_opts = {"quiet": True, "extract_flat": False, "ignoreerrors": True}

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        entries = info.get("entries", [info])

        for entry in entries:
            if not entry: continue
            raw_title = entry.get("title", "")

            # Clean common YouTube noise
            clean = re.sub(r'[\[\(].*?(official|lyric|hd|hq|4k|video|audio).*?[\]\)]', "", raw_title, flags=re.I)
            if " - " in clean:
                parts = clean.split(" - ", 1)
                a, t, s = parts[0].strip(), parts[1].strip(), "new"
            else:
                # Attempt to find artist in 'Provided to YouTube' descriptions
                a, t, s = "", clean.strip(), "needs_review"
                desc = entry.get("description", "")
                if desc and " · " in desc:
                    # Logic for YouTube Art Tracks
                    lines = desc.splitlines()
                    for line in lines:
                        if " · " in line and "Provided to YouTube" not in line:
                            meta_parts = line.split(" · ")
                            if len(meta_parts) >= 2:
                                a, s = meta_parts[1].strip(), "new"
                                break

            rows.append({
                "artist": a, "title": t, "raw_title": raw_title,
                "status": s, "source_url": entry.get("webpage_url")
            })

    with open(QUEUE_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=QUEUE_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f">>> Successfully queued {len(rows)} tracks to {QUEUE_FILE.name}")


# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="YouTube Playlist to Soulseek Downloader")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--fetch", nargs="?", const="__use_config__", help="Fetch YT Metadata")
    group.add_argument("--download", action="store_true", help="Run Soulseek download and analysis")

    args = parser.parse_args()

    if args.fetch:
        target_url = YOUTUBE_URL if args.fetch == "__use_config__" else args.fetch
        cmd_fetch(target_url)
    elif args.download:
        cmd_download()


if __name__ == "__main__":
    main()