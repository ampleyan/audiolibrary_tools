# audiolibrary_tools

Music library automation toolkit. Two separate tools:

- **DJ Prep Tool** — Windows desktop app (Tauri + React) and Docker web edition for building DJ sets: import tracklists → search Soulseek → download → quality-check → Beets tagging → Rekordbox.
- **Python scripts** — Library organiser, Redacted cross-seeder, YouTube→Soulseek batch downloader.

---

## DJ Prep Tool

### Docker web app — Raspberry Pi or Windows

**[Full launch, setup, stop, update, and troubleshooting guide](dj-prep-tool/README-RPI5.md)**

On the current Raspberry Pi (`192.168.129.39`):

```bash
cd /home/ampleyan/projects/audiolibrary_tools/dj-prep-tool
docker compose -f docker-compose.rpi5.yml up -d --wait
```

Open **http://192.168.129.39:8080**. PostgreSQL and the separately managed
Sockseek daemon must already be running. This starts the web app and Beets.

On Windows, complete the [Windows settings steps](dj-prep-tool/README-RPI5.md#windows--docker-desktop)
first, then run from the repository root in PowerShell:

```powershell
cd dj-prep-tool
docker compose -f docker-compose-win.yml up -d --build
```

Open **http://localhost:8080**. Windows runs the app, Sockseek, and Beets
locally and connects to PostgreSQL on the Pi.

The prerequisites below are for the **native Tauri desktop app**. The Docker
web app does not require a host Rust, Node.js, or Python installation.

### Prerequisites

| Requirement | Install |
|---|---|
| Rust + cargo | `winget install Rustlang.Rustup` |
| VS BuildTools 2022 (C++ workload) | [visualstudio.microsoft.com/downloads](https://visualstudio.microsoft.com/downloads/) → Build Tools → Desktop development with C++ |
| Windows SDK 10.0.26100 | `winget install Microsoft.WindowsSDK.10.0.26100` |
| Node.js 18+ | `winget install OpenJS.NodeJS` |
| Python 3.10+ | `winget install Python.Python.3.12` |
| ffmpeg | `winget install Gyan.FFmpeg` — must be on PATH |

Python dependencies (for `yt_fetch.py` and `audio_check.py`):

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install yt-dlp numpy scipy
```

### Launch (development)

```powershell
cd dj-prep-tool
.\dev.ps1
```

`dev.ps1` sets the MSVC + Windows SDK environment variables that cargo needs and then runs `npm run tauri dev`. On first run, cargo downloads ~300 MB of crates.

### First run

The app opens to a **Setup** screen. Fill in:

| Field | What to enter |
|---|---|
| Sockseek.exe | Path to `tools/sockseek/sockseek.exe` |
| Prep inbox folder | Where downloaded files land (sockseek output dir) |
| Rekordbox import folder | Folder Rekordbox watches for new tracks |
| Rekordbox XML library | Optional exported `rekordbox.xml` used to detect existing tracks |
| ffmpeg executable | Path to `ffmpeg.exe` (if not on PATH) |
| Python executable | Leave blank to use `.venv\Scripts\python.exe` automatically |
| Sockseek daemon URL | `http://127.0.0.1:5030` (default) |
| Soulseek username / password | Written to local SQLite DB only — never returned to the UI |

Click **Save & continue**, then click **Launch daemon** to start the Sockseek background process.

### Workflow

```
Import → Review → Downloads → Pipeline
```

1. **Import** — paste a tracklist, drop a CSV, or enter a YouTube URL.
2. **Review** — click **Search** on each track; ranked candidates appear (FLAC scored highest, then bitrate). Click **Approve** on the best match.
3. **Downloads** — click **Start download**, then **Poll for completion** (waits up to 10 min). Convert lossless files when needed, run **Quality check**, and run **Beets tagging**.
4. **Pipeline** — kanban board showing every track across all preparation stages. The Rekordbox handoff checks the configured XML first and does not copy a track already present there.

### Export a tracklist to Sockseek

In **Library**, filter and sort the tracks, then click **Export Sockseek CSV**
to download all shown tracks. Clear the filters to export the whole library.
In **Playlists**, open a playlist and use **Export Sockseek CSV** to download
that playlist. Exports follow the displayed order and do not change track states.

The UTF-8 CSV uses Sockseek's `artist,title` headers and includes mix versions
in the title, for example `Song (Extended Mix)`. Choose the downloaded CSV as
Sockseek's input file; no custom column mapping is needed.

### Telegram imports

Open **Add tracks → Telegram**, authorize once with Telegram API credentials, preview the newest posts, and import the displayed YouTube links. Existing tracks are skipped using a case-insensitive trimmed Artist + Title match, including duplicates within the same import. **Stop import** finishes the current metadata request and prevents the next link from starting.

The Telegram session is reused locally and stored in the app data directory. Credentials and session files are never committed or displayed in logs.

### Rekordbox duplicate detection

In **Settings**, paste the path to an XML export from Rekordbox and click **Check existing tracks**. Matching uses normalized Artist + Title values and reads the XML without modifying it. When a track is marked imported, a match is recorded as already present and no duplicate file is copied.

### Track states

```
requested → matched → approved → downloading → downloaded
                                                     ↓
                                             quality_failed
                                             ready_for_conversion → tagging_review → ready_for_rekordbox → dj_ready
```

### Build for production

```powershell
cd dj-prep-tool
.\dev.ps1   # replace `npm run tauri dev` with `npm run tauri build` inside the script
```

Or manually:

```powershell
$env:PATH = "C:\BuildTools\VC\Tools\MSVC\14.44.35207\bin\HostX64\x64;..."
npm run tauri build
```

---

## Python scripts

### Setup

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Copy `config.py` and fill in your paths and API keys. Never commit credentials.

### Commands

```bash
# Library organiser
python scripts/organize_music.py      # dry-run by default (set DRY_RUN=False to apply)
python scripts/organize_loose.py
python scripts/rename_folders.py

# YouTube → Soulseek batch downloader
python scripts/yt_slsk.py --fetch <youtube_url>
python scripts/yt_slsk.py --download

# Redacted.sh cross-seeder
python scripts/red_match.py
python scripts/red_match.py "Z:\path\to\album"

# Navidrome playlist export
python scripts/navidrome_export.py <playlist_name> output.m3u

# Tests
python tests/test_yt_slsk.py
```

### Folder naming convention

```
Artist - Album (Year) - Format Bitrate
DJ Shufflemaster - EXP (2001) - MP3 320
Various Artists - Some Comp (2018) - FLAC
```

---

## Project structure

```
audiolibrary_tools/
├── dj-prep-tool/              ← Tauri desktop app
│   ├── dev.ps1                ← Launch script (sets MSVC env + npm run tauri dev)
│   ├── src/                   ← React + TypeScript frontend
│   │   ├── lib/               ← api.ts (invoke wrappers), types.ts
│   │   └── views/             ← ImportView, ReviewView, DownloadView, PipelineView, SetupView
│   ├── src-tauri/src/         ← Rust backend
│   │   ├── db.rs              ← SQLite schema (tracks + settings tables)
│   │   ├── import.rs          ← Title parsing, CSV/text import, DB helpers
│   │   ├── scoring.rs         ← Candidate ranking (FLAC > MP3, bitrate, filename match)
│   │   ├── sockseek.rs        ← REST client for Sockseek daemon
│   │   ├── quality.rs         ← Audio quality checks via audio_check.py
│   │   ├── rekordbox.rs       ← Read-only Rekordbox XML matching
│   │   ├── config_store.rs    ← Settings CRUD (credentials write-only, never returned)
│   │   └── commands/          ← Tauri command handlers
│   └── py/                    ← Python bridge scripts
│       ├── yt_fetch.py        ← YouTube metadata → TrackDraft JSON
│       └── audio_check.py     ← AudioAnalyzer FFT wrapper
├── lib/                       ← Shared Python helpers
│   ├── audio.py               ← AudioAnalyzer (FFT fake-FLAC detection)
│   ├── queue.py               ← clean_title(), QueueManager, CSV helpers
│   ├── musiclib.py            ← Tag reading, folder naming
│   ├── downloader.py          ← SoulseekDownloader (sldl wrapper)
│   └── red_api.py             ← Redacted.sh API client
├── scripts/                   ← Standalone Python scripts
├── tools/
│   └── sockseek/              ← sockseek.exe + sockseek.conf (gitignored)
├── data/
│   └── dj_prep.sqlite         ← App database (gitignored — contains credentials)
├── config.py                  ← Python scripts config (do not commit credentials)
└── .gitignore
```

---

## Security notes

- `tools/sockseek/sockseek.conf` is gitignored — contains Soulseek credentials.
- `data/dj_prep.sqlite` is gitignored — settings table stores Soulseek credentials entered via the Setup UI.
- The DJ Prep Tool backend never returns credentials to the frontend; the UI only sees `hasSockseekCredentials: bool`.
- Telegram API credentials and the local Telegram session remain in the ignored app data directory.
- Rekordbox XML is read-only; the app does not modify Rekordbox's internal database.
- `config.py` — if it contains API keys, do not commit it. Add it to `.gitignore` or use environment variables.
