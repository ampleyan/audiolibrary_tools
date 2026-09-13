# DJ Prep Tool — Raspberry Pi 5 Web Edition

## Objective

Run the existing DJ preparation workflow from a Raspberry Pi 5 (64-bit Raspberry Pi OS) through a browser, while keeping the current Tauri desktop application working unchanged.

## Acceptance criteria

- A Raspberry Pi 5 can start the web edition with Docker Compose.
- The browser UI can import text, CSV, and playlist URLs.
- Tracks persist in SQLite across container restarts.
- The existing track state machine remains the source of truth.
- Search, loose search, candidate approval, download start, download polling, progress, and quality checks work through HTTP.
- Sockseek is configured as an external daemon URL; the container never expects `sockseek.exe`.
- Credentials remain server-side and are never returned to the browser.
- Music directories and the SQLite database are explicit host-mounted volumes.
- The Tauri app keeps using its current `invoke` API and is not regressed.

## Non-goals

- Running Windows `sockseek.exe` inside the ARM64 container.
- Launching Picard, Rekordbox, or local desktop folders from the browser.
- Replacing the Tauri application.
- Exposing the service beyond the local network without an authentication layer.
- Adding a second database schema or a second track state machine.

## Architecture

The frontend keeps one typed API surface. It selects Tauri `invoke` when running in the desktop shell and HTTP `fetch` when running in a browser.

The web backend is a Rust HTTP server built from the same library modules used by Tauri. Business operations are moved behind an application context containing the database path and configuration store. Tauri supplies that context from the app-data directory; the web server supplies it from environment variables and mounted paths.

```text
Browser → React API adapter → Rust HTTP server → shared import/search/download/quality logic
                                      ├── SQLite volume
                                      ├── music inbox volume
                                      └── external Sockseek daemon
```

The HTTP server binds to `0.0.0.0` inside the container. Docker publishes port `8080` to the host. Default configuration is local-network only.

## HTTP surface

The web API mirrors the existing frontend operations:

- `GET /api/settings`
- `PUT /api/settings`
- `POST /api/import/text`
- `POST /api/import/csv`
- `POST /api/import/playlist`
- `GET /api/tracks?state=...`
- `PATCH /api/tracks/{id}`
- `DELETE /api/tracks/{id}`
- `DELETE /api/tracks`
- `POST /api/tracks/{id}/search`
- `POST /api/tracks/{id}/search-loose`
- `POST /api/tracks/{id}/approve`
- `POST /api/tracks/{id}/download`
- `POST /api/tracks/{id}/poll-download`
- `GET /api/tracks/{id}/download-progress`
- `POST /api/tracks/{id}/quality-check`
- `GET /api/tracks/{id}/similar`
- `GET /api/daemon/health`

Desktop-only actions return a clear `409` response explaining that the action requires the Tauri app.

## Configuration and security

- `DJ_PREP_DATA_DIR` points to the SQLite/config directory.
- `DJ_PREP_INBOX_DIR` points to the mounted download inbox.
- `SOCKSEEK_URL` points to an externally running Sockseek daemon.
- API credentials are stored in SQLite, passed to subprocesses through environment variables, and omitted from all public settings responses.
- No credentials are placed in the Docker image, Compose file, frontend bundle, or command-line arguments.
- The server rejects malformed JSON, invalid IDs, unsupported state values, and paths outside configured directories where file access is required.

## Deployment

The image targets `linux/arm64` and uses Python 3.11 plus the existing helper scripts. Docker Compose mounts:

- `./data:/data`
- `./music-inbox:/music/inbox`
- `./music-archive:/music/archive`

Sockseek runs separately on the Pi or another machine reachable at `SOCKSEEK_URL`. The first release documents that arrangement rather than attempting to package a platform-specific daemon binary.

## Verification

- Shared Rust unit tests remain green.
- HTTP handler tests cover settings redaction, text import, track listing, state updates, and desktop-only responses.
- Frontend TypeScript check and production build pass.
- A Compose smoke test starts the ARM64 service, imports a sample track, restarts the container, and confirms persistence.
