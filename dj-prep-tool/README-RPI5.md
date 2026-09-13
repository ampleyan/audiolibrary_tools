# DJ Prep Tool on Raspberry Pi 5

This edition runs the app in a browser on a 64-bit Raspberry Pi OS installation.

## Requirements

- Raspberry Pi 5 with 64-bit Raspberry Pi OS
- Docker Engine and Docker Compose
- A Sockseek daemon reachable from the Pi
- Enough storage for the music inbox and archive

## Start

From the repository root:

```bash
cd dj-prep-tool
mkdir -p data music-inbox music-archive
SOCKSEEK_URL=http://127.0.0.1:5030 docker compose -f docker-compose.rpi5.yml up -d --build
```

Open `http://<raspberry-pi-ip>:8080` from a computer on the same network.

The database is stored in `dj-prep-tool/data`. Downloads and converted files are stored in `music-inbox` and `music-archive`.

## Sockseek

The web container does not launch `sockseek.exe`. Run a Linux ARM64 Sockseek daemon separately, or point `SOCKSEEK_URL` at a daemon on another machine:

```bash
SOCKSEEK_URL=http://192.168.1.20:5030 docker compose -f docker-compose.rpi5.yml up -d
```

Configure credentials from the app's Settings screen. They are stored in the mounted SQLite database and are not returned to the browser.

## YouTube playlists

Creating a playlist uses Google OAuth and is available in the web edition. In Google Cloud Console, enable YouTube Data API v3, create an OAuth web application, and add this redirect URI:

```text
http://<raspberry-pi-ip>:8080/api/youtube/callback
```

Start the container with the OAuth values supplied as environment variables. Keep the client secret out of the repository:

```bash
export YOUTUBE_CLIENT_ID='your-client-id'
export YOUTUBE_CLIENT_SECRET='your-client-secret'
export YOUTUBE_REDIRECT_URI='http://<raspberry-pi-ip>:8080/api/youtube/callback'
docker compose -f docker-compose.rpi5.yml up -d --build
```

The first playlist creation opens Google authorization. Playlists are private by default, and OAuth tokens remain in the mounted database.

## Desktop-only actions

Picard launching, opening local folders, and Rekordbox handoff are not available from a remote browser. The web flow converts approved downloads to 320 kbps MP3 and marks them ready for Rekordbox; copy the resulting file to the desktop manually.

## Stop and update

```bash
docker compose -f docker-compose.rpi5.yml down
docker compose -f docker-compose.rpi5.yml up -d --build
```

Stopping the container does not remove the database or mounted music directories.
