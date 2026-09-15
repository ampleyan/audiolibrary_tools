# DJ Prep Tool in Docker (Raspberry Pi or macOS)

This edition runs the app in a browser. The compose file also works with Docker Desktop on macOS; the filename is retained for Raspberry Pi compatibility.

## Requirements

- Raspberry Pi 5 with 64-bit Raspberry Pi OS, or macOS with Docker Desktop
- Docker Compose v2
- A Sockseek daemon reachable from the Pi
- Enough storage for the music inbox and archive

## Start

From the repository root:

```bash
cd dj-prep-tool
mkdir -p data music-library music-inbox music-archive rekordbox
SOCKSEEK_URL=http://127.0.0.1:5030 docker compose -f docker-compose.rpi5.yml up -d --build
```

Open `http://<raspberry-pi-ip>:8080` from a computer on the same network.

The database and stored Rekordbox XML are in `dj-prep-tool/data`. The library, downloads, and converted files are in `music-library`, `music-inbox`, and `music-archive`. These are bind mounts, so the same files remain available after a container rebuild and to other local tools.

## Shared macOS storage

The container uses these stable paths:

```text
/data             SQLite database, credentials, and uploaded rekordbox.xml
/music/library    Music library
/music/inbox      Sockseek download destination
/music/archive    Converted/DJ-ready files
/rekordbox        Optional externally exported Rekordbox XML (read-only)
```

Open `http://localhost:8080`, go to Settings, and use **Load XML into app**. The file is validated, copied to `/data/rekordbox.xml`, and selected automatically. This is the recommended way to share the XML with Docker because it avoids storing a macOS-only `/Users/...` path in settings.

The native development build also uses the repository `data/` directory, so its database and uploaded XML are shared with this Docker setup. A packaged native release keeps its own OS application-data directory.

To use an XML that Rekordbox exports directly into the mounted folder instead, start with:

```bash
DJ_PREP_REKORDBOX_XML=/rekordbox/rekordbox.xml \
  docker compose -f docker-compose.rpi5.yml up -d --build
```

Stop the native app before starting Docker if both use the same `data/dj_prep.sqlite`; SQLite is shared storage but should have one active writer at a time.

## Telegram channel import

Install the Python dependencies with `pip install -r requirements.txt`, then create an API ID and API hash at `my.telegram.org`. Enter them in Settings, save, open Add tracks → Telegram, and authorize your Telegram account with the one-time code. The session is stored in the app data directory; it is not committed or shown in logs.

Use channel ID `-1002508065505` for Doug Tenner Picks. The importer reads recent channel messages, extracts YouTube links, and sends each link through the normal YouTube metadata importer. In Docker, the session and credentials are stored in the mounted `/data` volume.

## Sockseek

The web container does not launch `sockseek.exe`. Run a Linux ARM64 Sockseek daemon separately, or point `SOCKSEEK_URL` at a daemon on another machine:

```bash
SOCKSEEK_URL=http://192.168.1.20:5030 docker compose -f docker-compose.rpi5.yml up -d
```

Configure credentials from the app's Settings screen. They are stored in the mounted SQLite database and are not returned to the browser.

## YouTube playlists

Creating a playlist uses Google OAuth. In Google Cloud Console, enable YouTube Data API v3, create an OAuth web application, and add both redirect URIs:

```text
http://localhost:8080/api/youtube/callback
http://127.0.0.1:43827/oauth2callback
```

Start the container with the OAuth values supplied as environment variables. Keep the client secret out of the repository:

```bash
export YOUTUBE_CLIENT_ID='your-client-id'
export YOUTUBE_CLIENT_SECRET='your-client-secret'
export YOUTUBE_REDIRECT_URI='http://localhost:8080/api/youtube/callback'
docker compose -f docker-compose.rpi5.yml up -d --build
```

The first playlist creation opens Google authorization. Playlists are private by default, and OAuth tokens remain in the mounted database.

For a browser on another computer, use an HTTPS hostname for the Pi instead of `localhost` and register that exact HTTPS callback URL.

## Windows Tauri app

Place the downloaded Google OAuth JSON at `dj-prep-tool/client_secret.json` and run `dev.ps1`. The script loads the client values into the process environment without committing the file. Register `http://127.0.0.1:43827/oauth2callback` as an additional redirect URI in the same Google OAuth client.

## Desktop-only actions

Beets tagging, opening local folders, and Rekordbox handoff are not available from a remote browser. The web flow converts approved downloads to 320 kbps MP3 and marks them ready for Rekordbox; copy the resulting file to the desktop manually.

## Stop and update

```bash
docker compose -f docker-compose.rpi5.yml down
docker compose -f docker-compose.rpi5.yml up -d --build
```

Stopping the container does not remove the database or mounted music directories.
