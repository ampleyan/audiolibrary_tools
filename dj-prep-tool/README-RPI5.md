# DJ Prep Tool in Docker (Raspberry Pi, macOS, or Windows)

This edition runs the app in a browser. State is stored in the shared
PostgreSQL platform on `kodisrv` (managed by the `rpi-postgresql` repo).

## Requirements

- Docker Compose v2
- PostgreSQL platform running on `kodisrv` (`192.168.129.39:5432`)
- `AUDIOTOOL_PASSWORD` — get it from `kodisrv`:
  ```bash
  ssh ampleyan@kodisrv "grep ^AUDIOTOOL_PASSWORD /home/ampleyan/projects/rpi-postgresql/infrastructure/postgres/.env"
  ```

## Raspberry Pi (local Unix socket)

Uses `DATABASE_MODE=local` — connects via Unix socket, no password or TLS needed.

```bash
cd dj-prep-tool
mkdir -p data music-library rekordbox
docker compose -f docker-compose.rpi5.yml up -d --build
```

Open `http://<pi-ip>:8080`.

## macOS with Colima (remote TCP)

Rancher Desktop and Docker Desktop cannot route LAN traffic from containers.
Use [Colima](https://github.com/abiosoft/colima) instead:

```bash
brew install colima docker docker-compose
colima start --network-address
```

Create `dj-prep-tool/.env`:
```
AUDIOTOOL_PASSWORD=<value from kodisrv>
```

```bash
cd dj-prep-tool
mkdir -p data music-library rekordbox
docker compose up -d --build
```

Open `http://localhost:8080`.

## Windows with Docker Desktop (remote TCP)

Docker Desktop for Windows routes LAN traffic from containers natively.

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) for Windows
2. Clone the repo and `cd dj-prep-tool`
3. Create `.env` in `dj-prep-tool\`:
   ```
   AUDIOTOOL_PASSWORD=<value from kodisrv>
   ```
4. Build and start:
   ```
   docker compose up -d --build
   ```
5. Open `http://localhost:8080`

Verify connectivity:
```
curl http://localhost:8080/api/health
```
Expected: `{"ok": true, "database": true, ...}`

If `database` is `false`, test from inside the container:
```
docker compose exec dj-prep python3 -c "import socket; s=socket.create_connection(('192.168.129.39', 5432), 5); print('ok'); s.close()"
```
If that fails, Docker Desktop's VM can't reach the LAN — run `wsl --update`
and retry; if still blocked, open a WSL2 terminal and forward the port:
```bash
socat TCP-LISTEN:15432,fork TCP:192.168.129.39:5432 &
```
Then set `DATABASE_URL: postgresql://audiotool@host.docker.internal:15432/audiotool` in `docker-compose.yml`.

## Volumes

```text
/data             App data directory
/music/library    Music library
/music/inbox      Sockseek download destination
/music/archive    Converted/DJ-ready files
/rekordbox        Optional externally exported Rekordbox XML (read-only)
```

## Rekordbox XML

Go to Settings → **Load XML into app**. The file is validated, copied to
`/data/rekordbox.xml`, and selected automatically. To use an XML exported
directly into the mounted folder:

```bash
DJ_PREP_REKORDBOX_XML=/rekordbox/rekordbox.xml docker compose up -d --build
```

## Sockseek

Point `SOCKSEEK_URL` at a running Sockseek daemon:

```bash
SOCKSEEK_URL=http://kodisrv:5030 docker compose up -d
```

## YouTube playlists

Enable YouTube Data API v3 in Google Cloud Console, create an OAuth web
client, and add the redirect URI `http://localhost:8080/api/youtube/callback`.
Supply credentials via environment variables or `.env`:

```
YOUTUBE_CLIENT_ID=your-client-id
YOUTUBE_CLIENT_SECRET=your-client-secret
YOUTUBE_REDIRECT_URI=http://localhost:8080/api/youtube/callback
```

## Windows Tauri app

Place the Google OAuth JSON at `dj-prep-tool/client_secret.json` and run
`dev.ps1`. Register `http://127.0.0.1:43827/oauth2callback` as an additional
redirect URI in the same OAuth client.

## Stop and update

```bash
docker compose down
git pull
docker compose up -d --build
```

Stopping the container does not remove mounted music directories.
