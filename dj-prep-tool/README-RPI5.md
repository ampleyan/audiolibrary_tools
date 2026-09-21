# DJ Prep Tool — Docker launch guide

Run commands from `dj-prep-tool`, using the Compose file for your machine.
The Docker edition opens in a browser and stores application state in the
existing PostgreSQL `audiotool` database. These files do not create PostgreSQL.

| Machine | Compose file | Browser address |
|---|---|---|
| Current Raspberry Pi | `docker-compose.rpi5.yml` | http://192.168.129.39:8080 |
| Windows with Docker Desktop | `docker-compose-win.yml` | http://localhost:8080 |

Always include the matching `-f` argument, including when stopping or updating.

## Raspberry Pi — current working setup

### 1. Check prerequisites

Docker must be running. PostgreSQL and the existing Sockseek daemon are
managed separately and must already be running. The Pi configuration starts
**the web app and Beets**, joining the existing Compose network containing
Sockseek at `http://sockseek:5030`.

```bash
cd /home/ampleyan/projects/audiolibrary_tools/dj-prep-tool
docker compose version
docker ps --format 'table {{.Names}}\t{{.Status}}'
test -S /home/ampleyan/projects/rpi-postgresql/infrastructure/postgres/run/.s.PGSQL.5432 && echo 'PostgreSQL socket exists'
ls -d /mnt/media/MUSIC/FROMTOOL /mnt/media/MUSIC/RECENT
```

Keep the current database credentials configured. `DATABASE_MODE=local`
means a Unix socket connection; it does not bypass database authentication.
No changes to the existing `.env` are needed for the current Pi deployment.

### 2. Launch

The current machine already has the images built:

```bash
docker compose -f docker-compose.rpi5.yml config --quiet
docker compose -f docker-compose.rpi5.yml up -d --wait
```

For a first build or after application code changes:

```bash
docker compose -f docker-compose.rpi5.yml up -d --build --wait
```

Open **http://192.168.129.39:8080** from another machine on the LAN, or
**http://localhost:8080** on the Pi itself.

### 3. Verify

```bash
docker compose -f docker-compose.rpi5.yml ps
curl --max-time 10 --fail http://localhost:8080/api/health
```

Expected response:

```json
{"ok": true, "database": true, "sockseek": true}
```

The `dj-prep` container should show `healthy`. Its health check validates
database connectivity. Beets should show `Up`.

### 4. Stop, start again, or update

Stop the app and Beets, keeping their containers:

```bash
docker compose -f docker-compose.rpi5.yml stop
```

Start again:

```bash
docker compose -f docker-compose.rpi5.yml up -d --wait
```

After updating source code, rebuild:

```bash
docker compose -f docker-compose.rpi5.yml up -d --build --wait
```

Sockseek belongs to a separate Compose file under the same project name.
An orphan warning about `dj-prep-tool-sockseek-1` is expected. **Do not use
`--remove-orphans`**: the app needs that daemon. Use `stop` above to stop
only the app and Beets without trying to remove the shared network.

### Pi storage and networking

| Host path | Container path | Purpose |
|---|---|---|
| `./data` | `/data` | App files, cookies, Beets database |
| `./music-library` | `/music/library` | Music library |
| `/mnt/media/MUSIC/FROMTOOL` | `/music/inbox` | Shared download inbox |
| `/mnt/media/MUSIC/RECENT` | `/music/archive` | Prepared music |
| `./rekordbox` | `/rekordbox` | Read-only XML exports |
| `/home/ampleyan/projects/rpi-postgresql/infrastructure/postgres/run` | `/var/run/postgresql` | PostgreSQL socket, app only |

The Pi file inherits app settings and port `8080` from `docker-compose.yml`.
It sets `DATABASE_MODE=local`, `SOCKSEEK_URL=http://sockseek:5030`, and
`BEETS_URL=http://beets:8337` explicitly. App and Beets use matching music
mounts; Sockseek's existing deployment downloads into the same host inbox.

## Windows — Docker Desktop

### 1. Prerequisites

- Docker Desktop running **Linux containers**.
- This repository checked out on the Windows machine.
- Network access to PostgreSQL on `192.168.129.39:5432`.
- The `audiotool` database password and Soulseek account credentials.
- Music folders accessible to Docker Desktop; this example uses `E:\MUSIC`.

The Windows file starts **the web app, Sockseek, and Beets**. PostgreSQL
continues to run on the Pi. A Windows launch has not been tested from this
Pi; the instructions below follow `docker-compose-win.yml`.

### 2. Set paths and connection settings

Open PowerShell in the repository root:

```powershell
cd dj-prep-tool
New-Item -ItemType Directory -Force -Path data,music-library,rekordbox | Out-Null
New-Item -ItemType Directory -Force -Path E:\MUSIC\FROMTOOL,E:\MUSIC\RECENT | Out-Null

$env:DATABASE_MODE = 'remote'
$env:DATABASE_URL = 'postgresql://audiotool@192.168.129.39:5432/audiotool'
$env:DATABASE_SSLMODE = 'disable'
$env:MUSIC_INBOX_DIR = 'E:/MUSIC/FROMTOOL'
$env:MUSIC_ARCHIVE_DIR = 'E:/MUSIC/RECENT'
$env:SOCKSEEK_URL = 'http://sockseek:5030'
$env:BEETS_URL = 'http://beets:8337'
```

Adjust the host address and drive paths if yours differ. This matches the
current database configuration; use your database's required SSL mode if
it differs. `host.docker.internal` on Windows refers to the Windows host,
so use the Pi address for this database.

### 3. Enter credentials without putting them in shell history

Run in the **same PowerShell window**:

```powershell
$env:SOCKSEEK_USERNAME = Read-Host 'Soulseek username'
$secret = Read-Host 'Soulseek password' -AsSecureString
$env:SOCKSEEK_PASSWORD = [System.Net.NetworkCredential]::new('', $secret).Password
$secret = Read-Host 'PostgreSQL audiotool password' -AsSecureString
$env:AUDIOTOOL_PASSWORD = [System.Net.NetworkCredential]::new('', $secret).Password
Remove-Variable secret
```

These environment variables override values in `.env` and last for this
PowerShell session. Repeat steps 2–3 in a new terminal before recreating
containers. Do not put real credentials in tracked files: `.env` is currently
tracked in this checkout. Use `config --quiet` for validation so resolved
credentials are not printed.

### 4. Build and launch

```powershell
docker compose -f docker-compose-win.yml config --quiet
docker compose -f docker-compose-win.yml up -d --build
```

Open **http://localhost:8080**.

### 5. Verify

```powershell
docker compose -f docker-compose-win.yml ps
Invoke-RestMethod http://localhost:8080/api/health
```

Expect `ok`, `database`, and `sockseek` to be `True`. If PostgreSQL cannot
be reached, check the host connection:

```powershell
Test-NetConnection 192.168.129.39 -Port 5432
```

If the host can connect but the app cannot, test from inside the app:

```powershell
docker compose -f docker-compose-win.yml exec dj-prep python -c "import socket; s=socket.create_connection(('192.168.129.39',5432),5); s.close(); print('PostgreSQL port reachable')"
```

### 6. Stop, start again, or update

```powershell
# Stop without removing containers or music.
docker compose -f docker-compose-win.yml stop

# Restart existing containers.
docker compose -f docker-compose-win.yml start

# After source updates, repeat settings steps 2–3 and rebuild.
docker compose -f docker-compose-win.yml up -d --build
```

## Troubleshooting

| Symptom | Check or fix |
|---|---|
| Browser cannot reach port 8080 | Use the platform-specific Compose file and check `ps`; allow port 8080 through the host firewall for LAN access. |
| Pi app is unhealthy / `database: false` | Verify the PostgreSQL socket exists, PostgreSQL is running, and the configured password is valid. |
| Windows `database: false` | Verify the Pi IP, port 5432, database credentials, and PostgreSQL client access rules. |
| `sockseek: false` | On Pi, check the separately managed daemon is running on the same network. On Windows, check the Sockseek container is running and credentials were supplied. |
| URL is `http://0.0.0.0:5030` | Use `http://sockseek:5030` inside containers. `0.0.0.0` is a listen address. |
| Beets cannot find downloaded files | App, Beets, and Sockseek must mount the same host inbox. |
| Pi reports an orphan Sockseek container | Expected for the separately managed daemon. Keep it running; do not remove orphans. |
| Docker socket permission denied | Run Docker commands with an account authorized to access Docker, or use `sudo` on Linux if configured. |

## Optional Rekordbox XML and cookies

In app Settings, use **Load XML into app** to copy an export into `/data`.
Alternatively, place it in the host `rekordbox` folder and configure its
container path, such as `/rekordbox/rekordbox.xml`.

Cookie paths also refer to the container: host `data/cookies.txt` is
`/data/cookies.txt`. Stopping or recreating containers preserves bind-mounted
music and data.
