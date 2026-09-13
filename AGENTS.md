# AGENTS.md — Handover for Codex

This file is the agent handover document for the `audiolibrary_tools` monorepo.
It covers both the legacy Python scripts and the primary active project: **dj-prep-tool**.

---

## Repository Layout

```
audiolibrary_tools/
├── config.py                        ← Legacy Python settings
├── lib/                             ← Shared Python helpers (musiclib, audio, queue, red_api)
├── scripts/                         ← Legacy automation scripts (organize, rename, cross-seed)
├── tests/                           ← Python script tests
├── tools/
│   ├── sldl/                        ← sldl binary (Soulseek downloader, NOT used by dj-prep-tool)
│   └── sockseek/                    ← sockseek.exe + gitignored sockseek.conf
├── userscripts/
│   └── cosine-export.user.js        ← Tampermonkey userscript (finished, standalone)
├── tests/
│   └── test_cosine_export.cjs       ← Node.js tests for the userscript
└── dj-prep-tool/                    ← PRIMARY active project (Tauri 2 desktop app)
    ├── py/                          ← Python subprocess helpers
    │   ├── yt_fetch.py              ← Universal playlist importer (YouTube/Spotify/Apple Music)
    │   ├── cosine_fetch.py          ← cosine.club similarity search via REST API
    │   ├── audio_check.py           ← FLAC authenticity checker
    │   └── convert_cookies.py       ← JSON → Netscape cookies converter
    ├── src/                         ← React + TypeScript frontend
    │   ├── App.tsx                  ← Tab shell (Import / Review / Download / Pipeline / Setup)
    │   ├── lib/
    │   │   ├── types.ts             ← Shared TS types (TrackRow, PublicSettings, SimilarTrack, …)
    │   │   └── api.ts               ← Tauri invoke wrappers (all backend calls go through here)
    │   └── views/
    │       ├── ImportView.tsx       ← Playlist/text/CSV import + track list
    │       ├── ReviewView.tsx       ← Search, edit, approve candidates, cosine Similar panel
    │       ├── DownloadView.tsx     ← Download queue + quality check
    │       ├── PipelineView.tsx     ← Full pipeline overview
    │       └── SetupView.tsx        ← Settings form (paths, credentials, daemon control)
    └── src-tauri/
        └── src/
            ├── lib.rs               ← App entry: registers all Tauri commands
            ├── db.rs                ← SQLite init, schema migrations, project_root()
            ├── config_store.rs      ← Settings key/value store; PublicSettings (no credentials)
            ├── import.rs            ← TrackDraft/TrackRow types, parse_text/parse_csv, DB helpers
            ├── scoring.rs           ← Candidate ranking: extension, bitrate, name match
            ├── quality.rs           ← FLAC authenticity check (calls audio_check.py)
            ├── sockseek.rs          ← SockseekClient: search(), results(), download() via REST
            └── commands/
                ├── mod.rs           ← pub mod declarations
                ├── import.rs        ← Tauri commands: get/save settings, import_*, list/update tracks
                ├── search.rs        ← search_track, approve_candidate, start_download
                ├── download.rs      ← poll_download, run_quality_check
                ├── daemon.rs        ← launch_sockseek, check_daemon
                └── cosine.rs        ← get_similar_tracks (calls cosine_fetch.py)
```

---

## What dj-prep-tool Does

Windows-first desktop DJ prep pipeline:

1. **Import** — paste a YouTube/Spotify/Apple Music playlist URL → `yt_fetch.py` extracts artist/title → tracks saved to SQLite as `requested`
2. **Review** — search each track on Soulseek via Sockseek daemon REST API → ranked candidates → approve best match → state → `approved`
3. **Download** — Sockseek downloads the approved file → state → `downloaded`
4. **Quality check** — `audio_check.py` verifies FLAC authenticity → state → `ready_for_conversion` or `quality_failed`
5. **Picard handoff** — open MusicBrainz Picard for tagging (manual)
6. **Rekordbox** — copy DJ-ready file to Rekordbox import folder → state → `dj_ready`

**cosine.club** provides per-track similarity recommendations (100 tracks with cosine scores) — useful for discovering tracks to add to the import list.

---

## Track State Machine

```
requested
  → matched       (search returned results, candidate_json populated)
  → requested     (search found nothing, error set, search_job_id set → "no results" UI)
matched
  → approved      (user approved a candidate)
approved
  → downloading   (download started)
downloading
  → downloaded    (file arrived)
downloaded
  → quality_failed | ready_for_conversion  (after quality check)
ready_for_conversion
  → picard_pending (manual)
picard_pending
  → dj_ready      (copy to rekordbox folder)
needs_review      (parse couldn't split artist/title cleanly — requires manual edit)
failed            (hard error)
```

---

## SECURITY CONSTRAINTS — READ BEFORE TOUCHING CREDENTIALS

These rules are permanent and non-negotiable:

- **Never print, log, or expose credentials** in stdout, stderr, UI state, or commit diffs.
- **Credentials live in the gitignored SQLite DB** (`data/dj_prep.sqlite`) settings table only.
- **`PublicSettings`** (returned to frontend) contains only `has_*: bool` flags — never the actual values.
- **Env vars only**: credentials passed to Python subprocesses as environment variables, never as CLI arguments (not visible in process lists).
- **`--no-config`** flag must always be passed to `sockseek.exe` to prevent it reading `sockseek.conf` automatically.
- **`cosine_api_key`** stored in DB, passed to `cosine_fetch.py` as `COSINE_API_KEY` env var.
- **`data/dj_prep.sqlite`** and **`tools/sockseek/sockseek.conf`** are gitignored.
- Do not add any new credentials to any tracked file.

---

## External APIs

### Sockseek (Soulseek daemon)
- REST at `http://127.0.0.1:5030` (configurable)
- `POST /api/searches` → `{ id }` (search job)
- `GET /api/searches/{id}/files` → file list with metadata
- `POST /api/downloads` → start download
- `GET /api/downloads/{id}` → poll status
- Credentials passed via `--username`/`--password` args when launching; `--no-config` always set.
- `src-tauri/src/sockseek.rs` wraps all calls.

### cosine.club
- Base URL: `https://cosine.club/api/v1/`
- `GET /search?q={artist+title}` → `{ data: [{ id, name, artist, track }] }`
- `GET /tracks/{id}/similar` → `{ data: { source_track, similar_tracks: [{ id, artist, track, video_uri, score }] } }`
- Auth: `Authorization: Bearer {cosine_api_key}` header
- 100 similar tracks returned, scored 0–1 (cosine similarity, discogs-effnet model)
- `dj-prep-tool/py/cosine_fetch.py` handles the full flow; `commands/cosine.rs` wraps it.

### Spotify (optional, for playlist import)
- Client credentials flow: `POST https://accounts.spotify.com/api/token`
- Paginated playlist tracks: `GET https://api.spotify.com/v1/playlists/{id}/tracks`
- `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` passed as env vars to `yt_fetch.py`

### YouTube (yt-dlp)
- `extract_flat: 'in_playlist'` — returns metadata without downloading audio
- Normalise watch?v=...&list=... → playlist?list=... before passing to yt-dlp
- Optional `cookies_file` arg for private playlists (Netscape format)

---

## Build & Run

### Prerequisites
- Rust (stable) + Cargo
- Node.js 20+ + pnpm (or npm)
- Python 3.11+ with `yt-dlp`, `requests` packages
- WebView2 runtime (pre-installed on Windows 11)
- sockseek.exe in `tools/sockseek/`

### Dev mode
```powershell
cd dj-prep-tool
pnpm install          # or npm install
pnpm tauri dev        # starts Vite + Tauri hot-reload
```

### Type check (run before reporting done)
```powershell
cd dj-prep-tool
npx tsc --noEmit                         # frontend TS
cd src-tauri && cargo check              # Rust backend
```

### Python venv
```powershell
cd dj-prep-tool
python -m venv .venv
.venv\Scripts\activate
pip install yt-dlp requests
```
The Rust backend auto-detects `.venv/Scripts/python.exe` via `db::project_root()`.

---

## Database Schema (SQLite)

**`settings`** table: `key TEXT PRIMARY KEY, value TEXT`

Key names stored: `sockseek_path`, `sockseek_daemon_url`, `prep_inbox_dir`, `rekordbox_import_dir`, `picard_path`, `ffmpeg_path`, `python_path`, `yt_cookies_file`, `sockseek_username`, `sockseek_password`, `spotify_client_id`, `spotify_client_secret`, `cosine_api_key`, `setup_complete`

**`tracks`** table: all fields in `import::TrackRow` — id, artist, title, mix_version, source_url, state, candidate_json, selected_username, selected_filename, downloaded_path, quality_result, quality_notes, archive_path, dj_path, search_job_id, download_job_id, error, created_at, updated_at

Schema init is in `db.rs::init()`. Migrations are append-only SQL blocks gated by `PRAGMA user_version`.

---

## Tauri Commands Reference

All commands are in `src-tauri/src/commands/` and registered in `lib.rs`.

| Command | File | Description |
|---|---|---|
| `get_settings` | import.rs | Returns `PublicSettings` (no credentials) |
| `save_settings` | import.rs | Persists settings payload to DB |
| `import_text` | import.rs | Parse `Artist - Title` lines |
| `import_csv` | import.rs | Parse CSV with headers |
| `import_youtube` | import.rs | Run `yt_fetch.py` subprocess |
| `list_tracks` | import.rs | Optional state filter |
| `update_track_state` | import.rs | Set state directly |
| `delete_track` | import.rs | DELETE by id |
| `clear_tracks` | import.rs | DELETE all |
| `update_track` | import.rs | Edit artist/title/mix_version |
| `search_track` | search.rs | Sockseek search → ranked candidates |
| `approve_candidate` | search.rs | Set selected username/filename |
| `start_download` | search.rs | Trigger Sockseek download |
| `poll_download` | download.rs | Check download status |
| `run_quality_check` | download.rs | Run audio_check.py |
| `launch_sockseek` | daemon.rs | Spawn sockseek.exe with credentials |
| `check_daemon` | daemon.rs | Ping daemon health endpoint |
| `get_similar_tracks` | cosine.rs | Run cosine_fetch.py, return SimilarTrack[] |

---

## Frontend API Contract

All Tauri calls go through `src/lib/api.ts`. Never call `invoke` directly in components.
Types are in `src/lib/types.ts`.

Key types:
```typescript
TrackRow          // DB row returned by most commands
PublicSettings    // Settings visible to frontend (no secrets)
SimilarTrack      // { artist, title, mixVersion, videoUrl, cosineId, score }
RankedCandidate   // { candidate: Candidate, score: number }
SaveSettingsPayload // Optional fields — only non-empty ones are persisted
```

---

## Code Style Rules

- **No inline comments** unless the WHY is non-obvious
- **No Python type annotations**
- **No `push` to remote** — user does all git pushes manually
- Phases ≤ 5 files: stop after each phase and wait for approval
- TDD for parsing, scoring, state transitions
- `sockseek.exe` is the downloader — do NOT use `sldl` wrapper in dj-prep-tool

## Context Handoff

When the conversation is nearing context exhaustion, invoke the `claude-handoff` skill before compaction. Launch `claude --bg --name "DJ Prep Tool Handoff" "<redacted summary with current state, next steps, blockers, and suggested skills>"`. Never include credentials, tokens, passwords, or private user data in the handoff prompt. Preserve unrelated working-tree changes and report the background job result.

---

## Pending Work

### 1. Loose Soulseek search (user-requested)
When a track has no results, offer a "Search loose" fallback that sends a less precise query to Sockseek — e.g. combine artist+title into a single title-only query (Sockseek `GET /api/searches?title={artist+title}`). This gives a wider net for obscure tracks.

Implementation sketch:
- Add `search_track_loose(track_id)` command in `commands/search.rs`
- In `ReviewView.tsx`, show "Search loose" button on `noResults` tracks (state=requested + search_job_id set)
- Same flow as `search_track` but different Sockseek query params

### 2. Download view polish
`DownloadView.tsx` and `PipelineView.tsx` were scaffolded but not fully wired. The `poll_download` and `run_quality_check` commands exist in Rust but the UI flow for moving tracks through `downloaded → quality_failed/ready_for_conversion → picard_pending → dj_ready` is incomplete.

### 3. Picard + Rekordbox handoff
No automation yet for copying files into the Rekordbox import folder or launching Picard with the selected file. These would be new Tauri commands + UI buttons in DownloadView.

### 4. cosine.club — import from Similar panel
The Similar panel in ReviewView shows 100 similar tracks with YouTube links. A natural next step: "Add to import list" button per row that calls `import_text` with that artist/title — letting users build out a tracklist from recommendations directly.

### 5. Sockseek search — mix version field
Currently `search_track` passes only artist and title to Sockseek. The Sockseek API accepts an optional mix version / subtitle field. Passing `mix_version` would narrow searches for remixed tracks and reduce false matches.

---

## Legacy Python Scripts

The `scripts/`, `lib/`, `config.py` files are a separate standalone toolset for music library organisation and RED cross-seeding. They are independent of dj-prep-tool and can be ignored when working on the Tauri app.

- `scripts/organize_music.py` — scan staging folder, move to `Artist - Album (Year) - Format`
- `scripts/red_match.py` — match local albums to Redacted.sh torrents, cross-seed via qBittorrent
- `scripts/yt_slsk.py` — legacy YouTube → Soulseek batch downloader (pre-dates dj-prep-tool)
- `config.py` — all settings; `RED_API_KEY`, `RED_PASSKEY` are secrets — do not commit values

---

## What Was Completed in the Last Session

1. `py/cosine_fetch.py` — full rewrite: pure REST API (no playwright), Bearer auth via `COSINE_API_KEY` env var, best-match scoring by artist/title word overlap, returns 100 similar tracks as newline-delimited JSON
2. `src-tauri/src/commands/cosine.rs` — `get_similar_tracks(track_id)`: reads track from DB, spawns `cosine_fetch.py` with API key as env var, deserialises results
3. `config_store.rs` — added `has_cosine_credentials` to `PublicSettings`
4. `commands/import.rs` — added `cosine_api_key` to `SaveSettingsPayload` and persistence
5. `src/lib/types.ts` — added `hasCosineCredentials`, `SimilarTrack` interface
6. `src/lib/api.ts` — added `cosineApiKey` to payload, `getSimilarTracks` call
7. `SetupView.tsx` — cosine.club API key section (password field, shows ✓ when set)
8. `ReviewView.tsx` — "Similar" button per track card: lazy-fetches on first click, toggles scrollable panel showing score / artist–title / mix version / YouTube ▶ link

Both `tsc --noEmit` and `cargo check` pass clean after these changes.
