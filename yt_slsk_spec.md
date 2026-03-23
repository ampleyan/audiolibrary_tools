# Design: YouTube → Soulseek Batch Downloader (`yt_slsk.py`)

**Date:** 2026-03-23
**Status:** Draft

---

## Overview

A standalone Python script that extracts track titles from a YouTube playlist or channel URL, cleans the names, deduplicates against a persistent log, and feeds the result to `slsk-batchdl` for Soulseek downloads. After downloading, produces a report and maintains separate CSVs for not-found and failed tracks.

Follows the existing project convention: standalone script, config block at top, `DRY_RUN` flag, no shared module. All data files live alongside the script.

---

## Architecture

Single script: `yt_slsk.py`. Two CLI phases — `--fetch` and `--download`.

### Phase 1: `--fetch [url]`

URL source (in order of precedence):
1. CLI argument `--fetch <url>` — takes precedence
2. `YOUTUBE_URL` from config block
3. Neither set → print error and exit

**DRY_RUN=True behaviour:** print what would be fetched (track list + dedup counts) but do NOT write `yt_slsk_queue.csv`. No side effects.

**DRY_RUN=False behaviour:**
1. Use `yt-dlp` (metadata only, no audio) to extract track titles from playlist/channel
2. Clean each title (see Cleaning section)
3. Load `yt_slsk_log.json` and deduplicate:
   - Log status `downloaded` → queue status `skip`
   - Log status `not_found` or `failed` → queue status `retry`
   - Not in log → queue status `new`
4. Write `yt_slsk_queue.csv`
5. Print summary: N new, N retry, N needs_review, N skipped

### Manual review (between phases)

User edits `yt_slsk_queue.csv`:
- Fix `needs_review` rows (add artist, correct title)
- Delete rows to exclude
- Change status to `skip` to suppress a track

### Phase 2: `--download`

**Always refuses if DRY_RUN=True** — prints reminder and exits.

1. Read `yt_slsk_queue.csv` — process rows with status `new`, `retry`, or `needs_review`; ignore `skip`
2. Build `_slsk_input.tmp` in the script's directory (see Input File Format)
3. Shell out: `SLSKD_CMD --input _slsk_input.tmp --output SLSK_OUTPUT_DIR --no-progress`; capture stdout+stderr line by line
4. Parse output lines → map each to a queue row (see Output Parsing)
5. Update `yt_slsk_log.json`
6. Rewrite `yt_slsk_not_found.csv` and `yt_slsk_failed.csv` (safe write: write to `.tmp`, rename)
7. Delete `_slsk_input.tmp`
8. Print report

---

## Input File Format for slsk-batchdl

`_slsk_input.tmp` is written in the same directory as `yt_slsk.py`.

One search query per line, in the format `slsk-batchdl` expects as search terms:

```
Surgeon - Magneze
Blawan - Getting Me Down
Some Title Without Artist
```

For `needs_review` rows where artist is blank, only the title is written (no leading ` - `).

Each line in the temp file corresponds positionally to a row in the processed queue (rows with status `skip` are excluded). Row mapping is by position: line 1 in temp file = first processed queue row, line 2 = second, etc.

---

## Output Parsing

`slsk-batchdl` is invoked with `--no-progress`. Output is captured line by line. Because slsk-batchdl echoes the search term when reporting a result, each output line is matched to a queue row by the search term it contains. Fallback: if echo-matching fails, fall back to positional matching.

**Classification patterns (case-insensitive):**

| Pattern in output line | Classification |
|------------------------|---------------|
| `Succeeded` / `downloaded` | `downloaded` |
| `Not found` / `no results` / `failed to find` | `not_found` |
| `Error` / `exception` / `timed out` / `connection` | `failed` |
| No match | `failed` (warn: "unrecognized output line: ...") |

The script trusts `slsk-batchdl` output text; it does not verify file existence on disk.

---

## Data Files

All files live in the same directory as `yt_slsk.py`.

| File | Purpose |
|------|---------|
| `yt_slsk_queue.csv` | Per-run input queue; human-editable |
| `yt_slsk_log.json` | Persistent log; keyed by normalized artist-title |
| `yt_slsk_not_found.csv` | Tracks Soulseek had no results for |
| `yt_slsk_failed.csv` | Tracks that errored during download |
| `_slsk_input.tmp` | Temp file passed to slsk-batchdl; deleted after run |

### Log entry format (`yt_slsk_log.json`)

Key is `normalize(artist + " - " + title)` where normalize = lowercase + strip. For `needs_review` rows where artist is blank, key is `normalize(title)` (no leading ` - `).

```json
{
  "surgeon - magneze": {
    "artist": "Surgeon",
    "title": "Magneze",
    "raw_title": "Surgeon - Magneze [Official Video] [HD]",
    "status": "downloaded",
    "date": "2026-03-23",
    "source_url": "https://youtube.com/playlist?list=..."
  }
}
```

Log statuses: `downloaded`, `not_found`, `failed`.

### Queue CSV columns

`artist, title, raw_title, status, source_url`

**Queue status values:**

| Status | Meaning | `--download` behaviour |
|--------|---------|----------------------|
| `new` | Not in log | Process |
| `retry` | Previously not_found or failed | Process |
| `needs_review` | No ` - ` found; artist blank | Process (title-only search) |
| `skip` | Already downloaded | Ignore |

### Not-found / failed CSV columns

`artist, title, raw_title, date, source_url`

Both CSVs are rewritten in full each `--download` run (safe write). Deduplicated by normalized key. When a retry succeeds, the entry is removed.

---

## Title Cleaning

Input expected as `Artist - Title [junk]`.

**Stripping order:**

1. Bracketed suffixes (case-insensitive regex): `[Official Video]`, `[HD]`, `[HQ]`, `(Official Audio)`, `(Lyrics)`, `(Music Video)`, `[Free Download]`, `[4K]`, `(320kbps)`, etc.
2. Trailing pipe/slash noise: `| anything`, `// anything`
3. Bare unbracketed trailing keywords: `Official Video`, `Official Audio`, `HQ`, `HD`
4. Whitespace normalization: collapse multiple spaces, strip

**Splitting:**

Split on the first ` - ` to get `artist` and `title`. If no ` - ` found, `artist = ""`, queue `status = "needs_review"`.

**Examples:**

| Raw | Artist | Title | Status |
|-----|--------|-------|--------|
| `Surgeon - Magneze [Official Video] [HD]` | Surgeon | Magneze | new |
| `Ancient Methods - Stalker (Official Audio)` | Ancient Methods | Stalker | new |
| `Blawan - Getting Me Down` | Blawan | Getting Me Down | new |
| `Some Mix Without Dash` | *(blank)* | Some Mix Without Dash | needs_review |

---

## Report Output

Printed after `--download`. SKIPPED = count of `status=skip` rows in the queue CSV (already in log from prior runs).

```
DOWNLOADED    (12): Surgeon - Magneze, Blawan - Getting Me Down, ...
NOT FOUND      (3): Ancient Methods - Stalker, ...
FAILED         (1): Some Track - Name
SKIPPED        (8): already in log
NEEDS REVIEW   (2): Some Mix Without Dash, ...
```

---

## Config Block

```python
DRY_RUN         = True                     # set False to actually download
YOUTUBE_URL     = ""                       # default URL; overridden by --fetch <url>
SLSKD_CMD       = "slsk-batchdl"          # path or command name
QUEUE_FILE      = "yt_slsk_queue.csv"
LOG_FILE        = "yt_slsk_log.json"
NOT_FOUND_FILE  = "yt_slsk_not_found.csv"
FAILED_FILE     = "yt_slsk_failed.csv"
SLSK_OUTPUT_DIR = r"D:\MUSIC\TO PROCESS"  # passed to slsk-batchdl --output
```

---

## README Content (`README_yt_slsk.md`)

```markdown
# yt_slsk.py — YouTube → Soulseek Batch Downloader

Fetch track titles from a YouTube playlist or channel, clean them,
and download via slsk-batchdl.

## Requirements

    pip install yt-dlp
    # Install slsk-batchdl: https://github.com/fiso64/slsk-batchdl

## Setup

Edit the config block at the top of yt_slsk.py:
- Set SLSK_OUTPUT_DIR to your download staging folder
- Set DRY_RUN = False when ready to actually download

## Commands

    # Step 1 — fetch track list from a playlist or channel
    python yt_slsk.py --fetch https://youtube.com/playlist?list=...

    # Step 1 (dry run — preview only, no files written)
    # Set DRY_RUN = True, then:
    python yt_slsk.py --fetch https://youtube.com/playlist?list=...

    # Step 1 — use the URL hardcoded in the config block
    python yt_slsk.py --fetch

    # Step 2 — review yt_slsk_queue.csv
    # - Fix any rows with status=needs_review (no Artist - Title separator found)
    # - Delete rows you don't want downloaded
    # - Set status=skip to suppress individual tracks permanently

    # Step 3 — download (requires DRY_RUN = False in config)
    python yt_slsk.py --download

## Output Files

| File | Description |
|------|-------------|
| yt_slsk_queue.csv | Track queue — edit between fetch and download |
| yt_slsk_log.json | Persistent download history (prevents re-downloads) |
| yt_slsk_not_found.csv | Tracks not available on Soulseek |
| yt_slsk_failed.csv | Tracks that errored during download |

## Tips

- Re-run --fetch on the same URL to pick up new tracks added since last run
  (already downloaded tracks are automatically skipped)
- To retry not-found tracks: open yt_slsk_not_found.csv, change status to retry
  in yt_slsk_queue.csv, then run --download again
- After downloading, run organize_music.py on SLSK_OUTPUT_DIR to sort files
  into your library
```

---

## Dependencies

- `yt-dlp` — add to `requirements.txt`
- `slsk-batchdl` — external CLI, installed separately by user

---

## Out of Scope

- Automatic file organization (use `organize_music.py` manually)
- Direct Soulseek protocol integration
- GUI
- Retry limits / abandoned status
