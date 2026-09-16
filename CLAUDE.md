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
├── dj-prep-tool/              ← Web-based DJ prep pipeline (see below)
│   ├── docker-compose.yml     ← Runs dj-prep + sockseek containers
│   ├── sockseek-config/       ← Sockseek daemon config + convert-to-mp3.sh hook
│   ├── web/server.py          ← Python HTTP server (API + static file serving)
│   ├── py/                    ← Helper scripts called by server (yt_fetch, audio_check…)
│   └── src/                   ← React/TypeScript frontend (Vite)
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

## DJ Prep Tool

A web-based pipeline for preparing DJ tracks: import → search Soulseek → review candidates → download → quality check → tag → Rekordbox.

### Running with Docker

First time on any machine: copy `.env.example` to `.env` and fill in `AUDIOTOOL_PASSWORD`.

**Mac / Windows:**
```bash
cd dj-prep-tool
docker compose up -d --build
```

**Raspberry Pi (kodisrv):**
```bash
cd dj-prep-tool
docker compose -f docker-compose.yml -f docker-compose.rpi5.yml up -d --build
```

The rpi5 override uses `DATABASE_MODE=local` (Unix socket to the rpi-postgresql container) instead of TCP. The base compose uses `DATABASE_MODE=remote` (TCP to `host.docker.internal:5432`).

App runs at **http://localhost:8080**. Uses two containers:
- `dj-prep` — Python server + React frontend
- `sockseek` — Soulseek daemon (heiso/sockseek image, runs as linux/amd64 via Rosetta on Apple Silicon)

### PostgreSQL

The `audiotool` database must exist before starting. Password for the `audiotool` role goes in `.env` as `AUDIOTOOL_PASSWORD` — required on all platforms, both local-socket and remote-TCP modes check it.

### Sockseek

Config lives in `dj-prep-tool/sockseek-config/sockseek.conf`. Key settings:
- `path = "/data"` — downloads land in `dj-prep-tool/music-inbox/`
- `server-ip = 0.0.0.0` — required for container networking
- `on-complete` — calls `convert-to-mp3.sh` to convert non-MP3 files to 320k MP3

The `sockseek-config/Dockerfile` extends `heiso/sockseek` with ffmpeg and uuid-runtime for the conversion hook.

### App Settings

| Setting | Value |
|---|---|
| Sockseek daemon URL | `http://localhost:5030` (or `http://sockseek:5030` inside Docker) |
| Sockseek.exe path | leave blank (daemon runs separately) |

### YouTube Cookies

For private playlists or age-restricted content, export a Netscape-format `cookies.txt` from your browser (use the "Get cookies.txt" extension), place it in `dj-prep-tool/data/`, and set the path to `/data/cookies.txt` in Settings.

### YouTube OAuth (Create Playlist feature)

Set in a `.env` file next to `docker-compose.yml`:
```
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REDIRECT_URI=http://localhost:8080/api/youtube/callback
```
Get credentials from Google Cloud Console → APIs & Services → OAuth 2.0 Client IDs.

### PYTHONPATH

The server container sets `PYTHONPATH=/app` so that `py/*.py` scripts can import from `lib/` without path hacks.

### Features (current state as of 2026-09)

**Import tab** (keyboard shortcut 2):
- Text paste, CSV, YouTube/Spotify/Apple Music playlist URL, Telegram channel
- **Rekordbox XML tab**: load XML, search/multi-select playlists with track counts, bulk import selected tracks as `dj_ready`
- Auto-detect on insert: if imported track is already in Rekordbox XML → mark `dj_ready` immediately

**Search (Prepare tab)**:
- Normal search: `{ artist, title }` with strict Soulseek artist matching
- "Search harder": uses sockseek `artistMaybeWrong: true` + `options.downloadSettings.desperateSearch: true`
- 404 handling: if sockseek restarts mid-session, download resets track to `requested` with a clear error

**Discovery tab** (keyboard shortcut 5):
- Rekordbox XML browser: full track data (artist, title, BPM, key, genre, playlists)
- Playlist picker sidebar (150px, searchable, sticky) — single-select to filter the track table
- `check_rekordbox` returns `{ tracksInXml: RekordboxTrack[] }` with `inLibrary` flag

**Player (floating)**:
- Draggable via ⠿ handle at top of player window
- YouTube IFrame API preloaded at module load for autoplay with sound
- Auto-advances to next track on `ENDED`

**Logs**:
- `append_log` prints to stdout → visible in `docker logs dj-prep-tool-dj-prep-1 -f`
- "Logs" button in top nav opens centered modal (newest first, click outside or ✕ to close)

### Sockseek API reference

- Search: `POST /api/jobs/search/tracks` — body: `{ songQuery: { artist, title, artistMaybeWrong }, options: { downloadSettings: { desperateSearch } } }`
- Download: `POST /api/jobs/{searchJobId}/downloads/files` — body: `{ files: [{ username, filename }] }`
  - `filename` must exactly match `ref.filename` from search results (backslash paths, e.g. `user\folder\file.flac`)
- Poll result: `GET /api/jobs/{jobId}` → `summary.terminalOutcome === "Succeeded"`, download path in `payload.downloadPath`
- Job IDs are in-memory; lost on sockseek restart → 404 on download → app resets track to `requested`
