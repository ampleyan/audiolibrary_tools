# YouTube Playlist OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the web Similar tracks panel authorize Google once and create a private YouTube playlist from the selected or filtered recommendations.

**Architecture:** The browser requests an authorization URL from the Python web server, completes Google OAuth through a server callback, and then asks the server to create a playlist and add valid video IDs. OAuth client settings and refresh tokens remain in the server-side SQLite settings table; the existing Tauri text export remains available because it has no local callback server.

**Tech Stack:** React, TypeScript, Python standard library HTTP server, SQLite, YouTube Data API v3 OAuth 2.0.

**Spec:** `docs/superpowers/specs/2026-09-13-dj-prep-rpi5-web-edition.md`

## Global Constraints

- Never expose credentials or tokens to frontend state, logs, or command-line arguments.
- YouTube playlists are created as private by default.
- Tracks without a valid YouTube video ID are skipped and returned in the result summary.
- All frontend backend calls continue through `src/lib/api.ts`.
- No Python type annotations or inline comments.

### Task 1: Server-side YouTube OAuth and playlist commands

**Files:**
- Modify: `dj-prep-tool/web/server.py`
- Test: `dj-prep-tool/web/test_server.py`

**Interfaces:**
- `get_youtube_auth_url` returns `{"url": string}` and stores a short-lived OAuth state in memory.
- `youtube_oauth_callback` handles the Google callback, exchanges the code, and redirects to `/` with a success or error marker.
- `create_youtube_playlist` accepts `{trackIds: number[], title: string}` and returns `{playlistUrl: string, added: number, skipped: string[]}`.

- [ ] Add focused tests for OAuth state validation, token storage, playlist selection, and missing video IDs using mocked HTTP responses.
- [ ] Add Google authorization URL generation with a random state and a loopback callback URL.
- [ ] Add code exchange and refresh-token handling using `urllib.request`, keeping tokens in SQLite settings.
- [ ] Add playlist creation and playlist-item insertion with bearer authorization.
- [ ] Add command routing and callback routing without logging secrets or authorization codes.
- [ ] Run `python -m unittest dj-prep-tool/web/test_server.py`.

### Task 2: Typed frontend API and Similar panel action

**Files:**
- Modify: `dj-prep-tool/src/lib/api.ts`
- Modify: `dj-prep-tool/src/views/ReviewView.tsx`

**Interfaces:**
- `api.getYoutubeAuthUrl()` calls `get_youtube_auth_url`.
- `api.createYoutubePlaylist(trackIds, title)` calls `create_youtube_playlist`.

- [ ] Add typed API wrappers for the two commands.
- [ ] Add a web-only “Create YouTube playlist” action using the current filtered recommendation IDs.
- [ ] Open the server authorization URL when needed and retry after callback completion.
- [ ] Show playlist link, added count, and skipped tracks in the panel.
- [ ] Keep text playlist export available as a fallback in Tauri mode.
- [ ] Run `npx tsc --noEmit` and `npm run build`.

### Task 3: Setup and deployment documentation

**Files:**
- Modify: `dj-prep-tool/README-RPI5.md`
- Modify: `dj-prep-tool/web/Dockerfile`

- [ ] Document creating a Google OAuth web client and setting the redirect URI.
- [ ] Document the server environment variables for OAuth client ID, secret, and public base URL.
- [ ] Ensure the Docker image includes no client secret in the frontend bundle.
- [ ] Run `docker compose -f dj-prep-tool/docker-compose.rpi5.yml config --quiet` and rebuild the image.

### Acceptance

- Browser can authorize once, create a private playlist, and receive a clickable playlist URL.
- Selected or filtered similar tracks are added; duplicates are not added twice.
- Missing video IDs are reported without failing the whole playlist.
- Secrets remain server-side.
- TypeScript, Python tests, production build, and Docker checks pass.
