# Design: YouTube → Soulseek Batch Downloader (`yt_slsk.py`)

**Date:** 2026-03-23
**Status:** Approved

---

## Overview

A standalone Python script that extracts track titles from a YouTube playlist or channel URL, cleans the names, deduplicates against a persistent log, and feeds the result to `slsk-batchdl` for Soulseek downloads. After downloading, it produces a report and maintains separate CSVs for not-found and failed tracks.

Follows the existing project convention: standalone script, config block at top, no shared module.

---

## Architecture

Single script: `yt_slsk.py`. Two CLI phases — `--fetch` and `--download`.

### Phase 1: `--fetch <url>`

1. Use `yt-dlp` (metadata only, no audio download) to extract track titles from the playlist or channel
2. Clean each title (see Cleaning section)
3. Load `yt_slsk_log.json` and deduplicate:
   - Already `downloaded` → `skip`
   - Previously `not_found` or `failed` → `retry`
   - Not in log → `new`
4. Write `yt_slsk_queue.csv`
5. Print summary: N new, N retry, N skipped

### Manual review (between phases)

User edits `yt_slsk_queue.csv` to fix `needs_review` rows, delete unwanted tracks, or change statuses. Rows with status `skip` are ignored by `--download`.

### Phase 2: `--download`

1. Read `yt_slsk_queue.csv` — process rows with status `new` or `retry`
2. Build a temp input file (one `"Artist - Title"` per line) for slsk-batchdl
3. Shell out to `slsk-batchdl` — capture output line by line
4. Parse output → classify each track as `downloaded`, `not_found`, or `failed`
5. Update `yt_slsk_log.json`
6. Append new entries to `yt_slsk_not_found.csv` and `yt_slsk_failed.csv`; remove entries that succeeded
7. Print report table

---

## Data Files

| File | Purpose |
|------|---------|
| `yt_slsk_queue.csv` | Per-run input queue; human-editable; ephemeral |
| `yt_slsk_log.json` | Persistent log for duplicate detection across all runs |
| `yt_slsk_not_found.csv` | Tracks Soulseek had no results for; appended across runs |
| `yt_slsk_failed.csv` | Tracks that errored during download; appended across runs |

### Log entry format (`yt_slsk_log.json`)

Keyed by normalized `"artist - title"` (lowercased, stripped):

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

Statuses: `downloaded`, `not_found`, `failed`, `skipped`.

### Queue CSV columns

`artist, title, raw_title, status, source_url`

Status values: `new`, `retry`, `skip`, `needs_review`

### Not-found / failed CSV columns

`artist, title, raw_title, date, source_url`

Both CSVs deduplicate by `artist - title` (no duplicate rows). When a retry succeeds, the entry is removed from the CSV.

---

## Title Cleaning

Input titles are expected to be `Artist - Title` format with YouTube junk appended.

**Stripping order:**

1. Bracketed suffixes (case-insensitive): `[Official Video]`, `[HD]`, `[HQ]`, `(Official Audio)`, `(Lyrics)`, `(Music Video)`, `[Free Download]`, `[4K]`, `(320kbps)`, etc.
2. Trailing pipe/slash noise: `| Label Name`, `// Label Name`
3. Bare unbracketed trailing keywords: `Official Video`, `Official Audio`, `HQ`, `HD`
4. Whitespace normalization: collapse multiple spaces, strip

**Splitting:**

Split on the first ` - ` to extract `artist` and `title`. If no ` - ` is found, `artist` is left blank and `status` is set to `needs_review`.

**Examples:**

| Raw | Artist | Title |
|-----|--------|-------|
| `Surgeon - Magneze [Official Video] [HD]` | Surgeon | Magneze |
| `Ancient Methods - Stalker (Official Audio)` | Ancient Methods | Stalker |
| `Blawan - Getting Me Down` | Blawan | Getting Me Down |
| `Some Mix Title Without Dash` | *(blank)* | Some Mix Title Without Dash → `needs_review` |

---

## Config Block

```python
YOUTUBE_URL     = ""                       # default URL; overridden by CLI arg
SLSKD_CMD       = "slsk-batchdl"          # path or command name
QUEUE_FILE      = "yt_slsk_queue.csv"
LOG_FILE        = "yt_slsk_log.json"
NOT_FOUND_FILE  = "yt_slsk_not_found.csv"
FAILED_FILE     = "yt_slsk_failed.csv"
SLSK_OUTPUT_DIR = r"D:\MUSIC\TO PROCESS"  # slsk-batchdl download destination
```

---

## Report Output

After `--download`:

```
DOWNLOADED  (12): Surgeon - Magneze, Blawan - Getting Me Down, ...
NOT FOUND    (3): Ancient Methods - Stalker, ...
FAILED       (1): Some Track - Name
SKIPPED      (8): already in log
```

---

## Dependencies

- `yt-dlp` — YouTube metadata extraction
- `slsk-batchdl` — Soulseek batch downloader (external CLI, must be installed separately)
- No new Python packages required beyond what yt-dlp brings

---

## README

A `README_yt_slsk.md` file is included alongside the script documenting all commands.

---

## Out of Scope

- Automatic file renaming / library organization (handled manually via existing `organize_music.py`)
- Direct Soulseek protocol integration
- GUI
