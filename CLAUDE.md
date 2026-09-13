# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A collection of Python scripts for music library automation: organizing local audio files, cross-seeding with Redacted.sh (RED), and downloading from Soulseek via YouTube playlists.

## Project Structure

```
audiolibrary_tools/
├── config.py                  ← All settings in one place — edit this to configure
├── lib/
│   ├── musiclib.py            ← Tag reading, folder naming, shared music helpers
│   ├── audio.py               ← AudioAnalyzer (FFT fake-FLAC detection)
│   ├── downloader.py          ← SoulseekDownloader (sldl subprocess wrapper)
│   ├── queue.py               ← QueueManager + CSV helpers for yt_slsk workflow
│   └── red_api.py             ← RedAPI client + parse_red_filelist()
├── scripts/
│   ├── organize_music.py      ← Scan + move audio into Artist - Album (Year) - Fmt folders
│   ├── organize_loose.py      ← Group loose flat audio files into album folders in-place
│   ├── rename_folders.py      ← Rename existing album folders to naming convention
│   ├── red_match.py           ← Match local albums to RED torrents, cross-seed via qBT
│   ├── yt_slsk.py             ← YouTube playlist → Soulseek batch downloader
│   └── navidrome_export.py    ← Export Navidrome playlist to M3U
├── data/                      ← Input files and generated runtime output
│   ├── input/                 ← CSV/TXT source lists
│   └── output/                ← Generated queues, reports, and summaries
├── tools/
│   ├── sldl/                  ← sldl binary + sldl.conf
│   └── sockseek/              ← Sockseek binary, config, and MP3 conversion hook
├── tests/
│   └── test_yt_slsk.py
└── run_organizer.bat          ← Quick launcher for organize_music.py
```

## Running the Scripts

```bash
pip install -r requirements.txt

# Organizer
python scripts/organize_music.py    # dry-run by default
python scripts/organize_loose.py
python scripts/rename_folders.py

# YouTube → Soulseek downloader
python scripts/yt_slsk.py --fetch [URL]
python scripts/yt_slsk.py --download

# RED cross-seeding
python scripts/red_match.py
python scripts/red_match.py "Z:\path\to\folder"

# Navidrome
python scripts/navidrome_export.py [playlist_name] [output.m3u]

# Tests
python tests/test_yt_slsk.py
```

## Configuration

All settings live in `config.py` at the project root. Scripts import it via:
```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
import config
```

Key settings:
- `DRY_RUN` / `RED_DRY_RUN` — always `True` by default; set `False` to apply changes
- `MUSIC_PROCESS_DIR` — staging folder scanned by organizer scripts
- `MUSIC_LIBRARY_DIR` — destination library folder
- `RED_API_KEY`, `RED_PASSKEY` — Redacted.sh credentials
- `SLSKD_CMD` — path to sldl.exe (default: `tools/sldl/sldl.exe`)

## Folder Naming Convention

```
Artist - Album (Year) - Format Bitrate
e.g.  DJ Shufflemaster - EXP (2001) - MP3 320
      Various Artists - Some Comp (2018) - FLAC
```

Format values: `MP3 320`, `MP3 256`, `MP3 192`, `MP3 160`, `MP3 128`, `FLAC`, `FLAC 24bit`, `AAC`, `OGG`, `WAV`

## Tag Priority

- **Artist**: TPE2 (album artist) → TPE1 (track artist) → albumartist → artist
- **Year**: originalyear → originaldate → date → TDRC (prefers original release year)
- **Album**: TALB → album; junk tags and URLs are stripped

## Shared Logic

All shared helpers live in `lib/` — do not duplicate across scripts:
- `lib/musiclib.py`: `safe_name()`, `get_tags()`, `get_artist()`, `get_album()`, `get_year()`, `get_fmt()`, `build_folder_name()`, `read_metadata()`
- `lib/audio.py`: `AudioAnalyzer.is_real_flac()` — FFT spectral analysis to detect upscaled fake FLACs
- `lib/downloader.py`: `SoulseekDownloader.run()` — wraps sldl subprocess, parses output line-by-line
- `lib/queue.py`: `QueueManager`, `clean_title()`, CSV read/write helpers
- `lib/red_api.py`: `RedAPI` (rate-limited RED REST client), `parse_red_filelist()`
