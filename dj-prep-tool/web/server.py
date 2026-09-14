import csv
import io
import json
import os
import re
import secrets
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get("DJ_PREP_DATA_DIR", "/data"))
DB_PATH = DATA_DIR / "dj_prep.sqlite"
INBOX_DIR = Path(os.environ.get("DJ_PREP_INBOX_DIR", "/music/inbox"))
ARCHIVE_DIR = Path(os.environ.get("DJ_PREP_ARCHIVE_DIR", "/music/archive"))
SOCKSEEK_URL = os.environ.get("SOCKSEEK_URL", "http://sockseek:5030").rstrip("/")
SOCKSEEK_LOG_FILE = os.environ.get("SOCKSEEK_LOG_FILE", "")
PYTHON = os.environ.get("PYTHON", "python3")
YOUTUBE_CLIENT_ID = os.environ.get("YOUTUBE_CLIENT_ID", "")
YOUTUBE_CLIENT_SECRET = os.environ.get("YOUTUBE_CLIENT_SECRET", "")
YOUTUBE_REDIRECT_URI = os.environ.get("YOUTUBE_REDIRECT_URI", "")
YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube"
YOUTUBE_STATES = {}
LOGS = []

SCHEMA = """
CREATE TABLE IF NOT EXISTS tracks (
 id INTEGER PRIMARY KEY AUTOINCREMENT, artist TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
 mix_version TEXT, source_url TEXT, state TEXT NOT NULL DEFAULT 'requested', candidate_json TEXT,
 selected_username TEXT, selected_filename TEXT, downloaded_path TEXT, quality_result TEXT,
 quality_notes TEXT, archive_path TEXT, dj_path TEXT, search_job_id TEXT, download_job_id TEXT,
 error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS tracks_updated_at AFTER UPDATE ON tracks FOR EACH ROW
BEGIN UPDATE tracks SET updated_at = datetime('now') WHERE id = NEW.id; END;
"""

NOISE = re.compile(r"(?i)[\[\(][^\[\(\]\)]*?(official|lyric|hd|hq|4k|video|audio|free\s*download|320kbps)[^\[\(\]\)]*?[\]\)]")
MIX = re.compile(r"(?i)\s*[\(\[]([\w\s\-'&]* (?:original|extended|radio|club|dub|instrumental|vocal|acapella|vip|remix|rmx|mix|edit|version|rework|bootleg|re-?edit|re-?work|re-?mix))[\)\]]\s*$")
EXT = re.compile(r"(?i)\.(mp3|flac|aac|ogg|wav|m4a|aif{1,2}|wma|opus)\s*$")
PREFIX = re.compile(r"^(?:(?:[-*•]\s+)|(?:\d{1,3}(?:[.\):]\s*|\s+-\s+)))+")

def db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn

def row_json(row):
    return dict(row)

def append_log(message):
    LOGS.append(message)
    del LOGS[:-300]

def get_logs():
    if SOCKSEEK_LOG_FILE:
        try:
            return [{"timestamp": "", "message": line} for line in Path(SOCKSEEK_LOG_FILE).read_text(encoding="utf-8", errors="replace").splitlines()[-300:]]
        except OSError:
            pass
    return [{"timestamp": "", "message": line} for line in LOGS]

def clean_pair(artist, title):
    artist = re.sub(r"\s{2,}", " ", artist.strip())
    title = re.sub(r"\s{2,}", " ", title.strip())
    title = NOISE.sub("", title).strip()
    title = EXT.sub("", title).strip()
    mix = None
    match = MIX.search(title)
    if match:
        mix = match.group(1).strip()
        title = MIX.sub("", title).strip()
    return artist, title, mix

def split_line(line):
    line = PREFIX.sub("", line.strip()).strip()
    separators = [" - ", " – ", " — ", "\t", " : "]
    found = [(line.find(s), s) for s in separators if line.find(s) >= 0]
    if not found:
        return "", line
    index, separator = min(found)
    return line[:index], line[index + len(separator):]

def parse_text(text):
    drafts = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        artist, title = split_line(line)
        artist, title, mix = clean_pair(artist, title)
        drafts.append((artist, title, mix, None, "requested" if artist and title else "needs_review", None))
    return drafts

def parse_csv(content):
    reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff")))
    aliases = {
        "artist": ("artist", "artist_name", "artist name"),
        "title": ("title", "track", "track_name", "track name", "song", "name"),
        "mix": ("mix_version", "mix version", "mix", "version", "remix"),
        "url": ("source_url", "url", "link", "youtube_url", "youtube"),
    }
    names = {str(k).strip().lower(): k for k in (reader.fieldnames or [])}
    key = lambda group: next((names[x] for x in aliases[group] if x in names), None)
    drafts = []
    for row in reader:
        artist = (row.get(key("artist"), "") if key("artist") else "").strip()
        title = (row.get(key("title"), "") if key("title") else "").strip()
        if not artist and " - " in title:
            artist, title = split_line(title)
        artist, title, mix = clean_pair(artist, title)
        supplied = (row.get(key("mix"), "") if key("mix") else "").strip() or mix
        if not title:
            continue
        url = (row.get(key("url"), "") if key("url") else "").strip() or None
        drafts.append((artist, title, supplied, url, "requested" if artist else "needs_review", None))
    return drafts

def insert(draft):
    conn = db()
    artist, title, mix_version, source_url, state, error = draft
    exists = conn.execute("SELECT EXISTS(SELECT 1 FROM tracks WHERE lower(trim(artist))=lower(trim(?)) AND lower(trim(title))=lower(trim(?)))", (artist, title)).fetchone()[0]
    if exists:
        error = f"{error}; duplicate of existing track" if error else "duplicate of existing track"
    cur = conn.execute("INSERT INTO tracks (artist,title,mix_version,source_url,state,error) VALUES (?,?,?,?,?,?)", (artist, title, mix_version, source_url, state, error))
    row = conn.execute("SELECT * FROM tracks WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.commit()
    conn.close()
    return row_json(row)

def tracks(state=None):
    conn = db()
    if state:
        rows = conn.execute("SELECT * FROM tracks WHERE state=? ORDER BY created_at DESC", (state,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM tracks ORDER BY created_at DESC").fetchall()
    conn.close()
    return [row_json(row) for row in rows]

def get_track(track_id):
    conn = db()
    row = conn.execute("SELECT * FROM tracks WHERE id=?", (track_id,)).fetchone()
    conn.close()
    if not row:
        raise ValueError("track not found")
    return row_json(row)

def setting(key, default=""):
    conn = db()
    row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    conn.close()
    return row[0] if row else default

def update(track_id, sql, values):
    conn = db()
    conn.execute(sql, (*values, track_id))
    row = conn.execute("SELECT * FROM tracks WHERE id=?", (track_id,)).fetchone()
    conn.commit()
    conn.close()
    return row_json(row) if row else None

def request(method, path, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(SOCKSEEK_URL + path, data=body, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode())

def youtube_token():
    access_token = setting("youtube_access_token")
    expires_at = float(setting("youtube_token_expires_at", "0") or 0)
    if access_token and expires_at > time.time() + 60:
        return access_token
    refresh_token = setting("youtube_refresh_token")
    if not refresh_token or not YOUTUBE_CLIENT_ID or not YOUTUBE_CLIENT_SECRET:
        return None
    body = urllib.parse.urlencode({"client_id": YOUTUBE_CLIENT_ID, "client_secret": YOUTUBE_CLIENT_SECRET, "refresh_token": refresh_token, "grant_type": "refresh_token"}).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST", headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=20) as response:
        token = json.loads(response.read().decode())
    conn = db()
    conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", ("youtube_access_token", token["access_token"]))
    conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", ("youtube_token_expires_at", str(time.time() + token.get("expires_in", 3600))))
    conn.commit(); conn.close()
    return token["access_token"]

def youtube_request(url, token, payload):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode())

def youtube_video_id(url):
    if not url: return None
    match = re.search(r"(?:[?&]v=|youtu\.be/|youtube\.com/embed/)([A-Za-z0-9_-]{6,})", url)
    return match.group(1) if match else None

def command(name, payload):
    if name != "get_logs": append_log(f"[app] {name}")
    if name == "get_logs": return get_logs()
    if name == "get_settings":
        conn = db()
        values = {row["key"]: row["value"] for row in conn.execute("SELECT key,value FROM settings")}
        conn.close()
        return {"sockseekPath": "", "sockseekDaemonUrl": values.get("sockseek_daemon_url", SOCKSEEK_URL), "prepInboxDir": str(INBOX_DIR), "picardPath": "", "ffmpegPath": "", "rekordboxImportDir": str(ARCHIVE_DIR), "pythonPath": PYTHON, "ytCookiesFile": "", "setupComplete": values.get("setup_complete") == "true", "hasSockseekCredentials": bool(values.get("sockseek_username") and values.get("sockseek_password")), "hasSpotifyCredentials": bool(values.get("spotify_client_id") and values.get("spotify_client_secret")), "hasCosineCredentials": bool(values.get("cosine_api_key"))}
    if name == "save_settings":
        payload = payload.get("payload", payload)
        conn = db()
        mapping = {"sockseekDaemonUrl": "sockseek_daemon_url", "setupComplete": "setup_complete", "sockseekUsername": "sockseek_username", "sockseekPassword": "sockseek_password", "spotifyClientId": "spotify_client_id", "spotifyClientSecret": "spotify_client_secret", "cosineApiKey": "cosine_api_key"}
        for key, value in payload.items():
            if key in mapping and value is not None:
                conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (mapping[key], str(value).lower() if isinstance(value, bool) else value))
        conn.commit(); conn.close(); return None
    if name in ("import_text", "import_csv"):
        content = payload.get("text", "") if name == "import_text" else payload.get("content", "")
        return [insert(draft) for draft in (parse_text(content) if name == "import_text" else parse_csv(content))]
    if name == "import_youtube":
        url = payload.get("url", "")
        script = ROOT / "py" / "yt_fetch.py"
        args = [PYTHON, str(script), url]
        cookies = setting("yt_cookies_file")
        if cookies: args.append(cookies)
        env = os.environ.copy()
        for key in ("spotify_client_id", "spotify_client_secret"):
            value = setting(key)
            if value: env["SPOTIFY_CLIENT_ID" if key.endswith("id") else "SPOTIFY_CLIENT_SECRET"] = value
        result = subprocess.run(args, capture_output=True, text=True, env=env, check=False)
        if result.returncode: raise ValueError(result.stderr.strip() or "Playlist import failed")
        return [insert((draft.get("artist", ""), draft.get("title", ""), draft.get("mix_version"), draft.get("source_url"), draft.get("state", "needs_review"), draft.get("notes"))) for draft in (json.loads(line) for line in result.stdout.splitlines() if line.strip())]
    if name == "list_tracks": return tracks(payload.get("state"))
    if name == "update_track_state": return update(int(payload["id"]), "UPDATE tracks SET state=? WHERE id=?", (payload["state"],))
    if name == "delete_track":
        conn = db(); conn.execute("DELETE FROM tracks WHERE id=?", (payload["id"],)); conn.commit(); conn.close(); return None
    if name == "clear_tracks":
        conn = db(); conn.execute("DELETE FROM tracks"); conn.commit(); conn.close(); return None
    if name == "update_track":
        return update(int(payload["id"]), "UPDATE tracks SET artist=?,title=?,mix_version=?,state=CASE WHEN state='needs_review' AND ?<>'' AND ?<>'' THEN 'requested' ELSE state END WHERE id=?", (payload["artist"], payload["title"], payload.get("mixVersion"), payload["artist"], payload["title"]))
    if name in ("search_track", "search_track_loose"):
        track = get_track(int(payload["trackId"]))
        query = track["title"] if name == "search_track" else f'{track["artist"]} {track["title"]}'
        body = {"songQuery": {"artist": track["artist"] if name == "search_track" else None, "title": query}}
        job = request("POST", "/api/jobs/search/tracks", body)["jobId"]
        update(track["id"], "UPDATE tracks SET search_job_id=?,state='matched',error=NULL WHERE id=?", (job,))
        results = []
        for _ in range(15):
            time.sleep(2)
            try:
                results = request("GET", f"/api/jobs/{job}/results/files").get("items", [])
                if results: break
            except Exception: pass
        wanted = f'{track["artist"]} {track["title"]}'.lower()
        ranked = []
        for candidate in results:
            filename = candidate.get("filename", "")
            score = sum(1 for word in wanted.split() if word and word in filename.lower())
            ranked.append({"candidate": candidate, "score": score})
        ranked.sort(key=lambda item: item["score"], reverse=True)
        if ranked:
            update(track["id"], "UPDATE tracks SET candidate_json=? WHERE id=?", (json.dumps(ranked),))
        else:
            update(track["id"], "UPDATE tracks SET state='requested',error=? WHERE id=?", ("No results found — try editing the artist/title or search again later",))
        return ranked
    if name == "approve_candidate":
        return update(int(payload["trackId"]), "UPDATE tracks SET selected_username=?,selected_filename=?,state='approved' WHERE id=?", (payload["username"], payload["filename"]))
    if name == "start_download":
        track = get_track(int(payload["trackId"]))
        if not track.get("search_job_id") or not track.get("selected_username") or not track.get("selected_filename"): raise ValueError("Approve a candidate before downloading")
        result = request("POST", f'/api/jobs/{track["search_job_id"]}/downloads/files', {"files": [{"username": track["selected_username"], "filename": track["selected_filename"]}]})
        job = result[0].get("jobId", "") if isinstance(result, list) and result else ""
        return update(track["id"], "UPDATE tracks SET download_job_id=?,state='downloading' WHERE id=?", (job,))
    if name == "cancel_download":
        track = get_track(int(payload["trackId"]))
        job_id = track.get("download_job_id")
        if not job_id:
            raise ValueError("track has no download job")
        request("POST", f"/api/jobs/{job_id}/cancel")
        return update(track["id"], "UPDATE tracks SET state='failed',error=? WHERE id=?", ("Download cancelled by user",))
    if name == "check_download_progress":
        track = get_track(int(payload["trackId"]))
        name_part = Path(track.get("selected_filename") or "").name
        found = next((path for path in (INBOX_DIR / name_part, INBOX_DIR / (name_part + ".part"), INBOX_DIR / (name_part + ".incomplete"), INBOX_DIR / (name_part + ".tmp")) if path.exists()), None)
        total = next((item["candidate"].get("size") for item in json.loads(track.get("candidate_json") or "[]") if Path(item["candidate"].get("filename", "")).name.lower() == name_part.lower()), None)
        return {"bytesOnDisk": found.stat().st_size if found else None, "bytesTotal": total}
    if name == "get_youtube_auth_url":
        if not YOUTUBE_CLIENT_ID or not YOUTUBE_CLIENT_SECRET or not YOUTUBE_REDIRECT_URI: raise ValueError("YouTube OAuth is not configured on the server")
        if youtube_token(): return {"authorized": True, "url": None}
        state = secrets.token_urlsafe(24)
        YOUTUBE_STATES[state] = time.time()
        query = urllib.parse.urlencode({"client_id": YOUTUBE_CLIENT_ID, "redirect_uri": YOUTUBE_REDIRECT_URI, "response_type": "code", "scope": YOUTUBE_SCOPE, "access_type": "offline", "prompt": "consent", "state": state})
        return {"authorized": False, "url": f"https://accounts.google.com/o/oauth2/v2/auth?{query}"}
    if name == "create_youtube_playlist":
        token = youtube_token()
        if not token: raise ValueError("Authorize YouTube before creating a playlist")
        video_ids = list(dict.fromkeys(item for item in payload.get("videoIds", []) if re.fullmatch(r"[A-Za-z0-9_-]{6,}", item or "")))
        if not video_ids: raise ValueError("No valid YouTube tracks selected")
        title = (payload.get("title") or "DJ Prep playlist").strip()[:150]
        playlist = youtube_request("https://youtube.googleapis.com/youtube/v3/playlists?part=snippet,status", token, {"snippet": {"title": title, "description": "Created by DJ Prep Tool"}, "status": {"privacyStatus": "private"}})
        skipped = list(payload.get("skipped", []))
        added = 0
        for video_id in video_ids:
            try:
                youtube_request("https://youtube.googleapis.com/youtube/v3/playlistItems?part=snippet", token, {"snippet": {"playlistId": playlist["id"], "resourceId": {"kind": "youtube#video", "videoId": video_id}}})
                added += 1
            except urllib.error.HTTPError:
                skipped.append(video_id)
        return {"playlistUrl": f"https://www.youtube.com/playlist?list={playlist['id']}", "added": added, "skipped": skipped}
    if name == "poll_download":
        track = get_track(int(payload["trackId"]))
        expected = Path(track.get("selected_filename") or "").name
        for _ in range(120):
            found = next((path for path in INBOX_DIR.iterdir() if path.name.lower() == expected.lower()), None) if INBOX_DIR.exists() else None
            if found:
                return update(track["id"], "UPDATE tracks SET downloaded_path=?,state='downloaded' WHERE id=?", (str(found),))["downloaded_path"]
            time.sleep(5)
        raise ValueError("download timed out after 10 minutes")
    if name == "run_quality_check":
        track = get_track(int(payload["trackId"]))
        path = track.get("downloaded_path")
        if not path: raise ValueError("track has no downloaded file")
        result = subprocess.run([PYTHON, str(ROOT / "py" / "audio_check.py"), path], capture_output=True, text=True, check=False)
        if result.returncode: raise ValueError(result.stderr.strip() or "Quality check failed")
        quality = json.loads(result.stdout)
        state = "quality_failed" if quality.get("is_real_flac") is False else "ready_for_conversion"
        update(track["id"], "UPDATE tracks SET quality_result=?,quality_notes=?,state=? WHERE id=?", ("fake_flac" if state == "quality_failed" else "ok", quality.get("notes", ""), state))
        return {"isRealFlac": quality.get("is_real_flac"), "sampleRate": None, "bitDepth": None, "channels": None, "durationSecs": None, "spectralCutoffHz": None, "notes": quality.get("notes", "")}
    if name == "get_similar_tracks":
        track = get_track(int(payload["trackId"]))
        key = setting("cosine_api_key")
        if not key: raise ValueError("cosine_api_key not configured — add it in Settings")
        env = os.environ.copy(); env["COSINE_API_KEY"] = key
        result = subprocess.run([PYTHON, str(ROOT / "py" / "cosine_fetch.py"), track["artist"], track["title"]], capture_output=True, text=True, env=env, check=False)
        if result.returncode: raise ValueError(result.stderr.strip() or "Similarity lookup failed")
        return [{"artist": item.get("artist", ""), "title": item.get("title", ""), "mixVersion": item.get("mix_version"), "videoUrl": item.get("video_url"), "cosineId": item.get("cosine_id", ""), "score": item.get("score", 0)} for item in (json.loads(line) for line in result.stdout.splitlines() if line.strip())]
    if name == "tag_track":
        track = get_track(int(payload["trackId"]))
        source = track.get("downloaded_path")
        if not source: raise ValueError("No downloaded file — run poll_download first")
        output = str(Path(source).with_suffix(".mp3"))
        result = subprocess.run(["ffmpeg", "-i", source, "-b:a", "320k", "-y", output], capture_output=True, text=True, check=False)
        if result.returncode: raise ValueError(result.stderr.strip() or "Conversion failed")
        return update(track["id"], "UPDATE tracks SET archive_path=?,state='ready_for_rekordbox',error=NULL WHERE id=?", (output,))
    if name in ("open_folder", "launch_sockseek"):
        raise ValueError("This action is only available in the desktop Tauri app")
    if name == "check_daemon":
        try: request("GET", ""); return True
        except Exception: return False
    if name == "validate_setup":
        try:
            request("GET", "")
            daemon_ok = True
        except Exception:
            daemon_ok = False
        checks = [{"name": "Sockseek daemon", "ok": daemon_ok, "detail": SOCKSEEK_URL}]
        conn = db()
        values = {row["key"]: row["value"] for row in conn.execute("SELECT key,value FROM settings")}
        conn.close()
        credentials_ok = bool(values.get("sockseek_username") and values.get("sockseek_password"))
        checks.append({"name": "Sockseek credentials", "ok": credentials_ok, "detail": "credentials saved" if credentials_ok else "username and password required"})
        for name, path, required in (("Prep inbox", INBOX_DIR, True), ("Rekordbox folder", ARCHIVE_DIR, False)):
            exists = path.exists()
            checks.append({"name": name, "ok": exists or not required, "detail": "path exists" if exists else ("required" if required else "optional")})
        return checks
    if name == "backup_database":
        backup_dir = DATA_DIR / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        destination = backup_dir / f"dj_prep-{int(time.time())}.sqlite"
        source = db()
        target = sqlite3.connect(destination)
        try:
            source.backup(target)
        finally:
            target.close()
            source.close()
        return str(destination)
    if name == "list_backups":
        backup_dir = DATA_DIR / "backups"
        if not backup_dir.exists():
            return []
        return sorted((path.name for path in backup_dir.iterdir() if path.is_file() and path.name.startswith("dj_prep-") and path.suffix == ".sqlite"), reverse=True)
    if name == "restore_database":
        backup_name = payload.get("backupName", "")
        if Path(backup_name).name != backup_name or not backup_name.startswith("dj_prep-") or not backup_name.endswith(".sqlite"):
            raise ValueError("invalid backup name")
        source_path = DATA_DIR / "backups" / backup_name
        if not source_path.is_file():
            raise ValueError("backup not found")
        source = sqlite3.connect(source_path)
        destination = sqlite3.connect(DB_PATH)
        try:
            source.backup(destination)
        finally:
            destination.close()
            source.close()
        return None
    raise ValueError(f"Unsupported web command: {name}")

def youtube_callback(query):
    state = query.get("state", [""])[0]
    issued = YOUTUBE_STATES.pop(state, 0)
    if not issued or time.time() - issued > 600: return "youtube=error&message=Invalid+or+expired+authorization"
    if query.get("error"): return "youtube=error&message=Authorization+cancelled"
    code = query.get("code", [""])[0]
    body = urllib.parse.urlencode({"code": code, "client_id": YOUTUBE_CLIENT_ID, "client_secret": YOUTUBE_CLIENT_SECRET, "redirect_uri": YOUTUBE_REDIRECT_URI, "grant_type": "authorization_code"}).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body, method="POST", headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=20) as response: token = json.loads(response.read().decode())
        conn = db()
        for key, value in (("youtube_access_token", token.get("access_token", "")), ("youtube_refresh_token", token.get("refresh_token", setting("youtube_refresh_token"))), ("youtube_token_expires_at", str(time.time() + token.get("expires_in", 3600)))):
            if value: conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (key, value))
        conn.commit(); conn.close()
        return "youtube=connected"
    except Exception: return "youtube=error&message=Authorization+failed"

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        return
    def send_json(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        if self.path == "/api/health":
            try:
                conn = db()
                conn.execute("SELECT 1")
                conn.close()
                database_ok = True
            except Exception:
                database_ok = False
            try:
                request("GET", "")
                sockseek_ok = True
            except Exception:
                sockseek_ok = False
            self.send_json(200, {"ok": database_ok, "database": database_ok, "sockseek": sockseek_ok})
            return
        if self.path.startswith("/api/youtube/callback"):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            self.send_response(302); self.send_header("Location", f"/?{youtube_callback(query)}"); self.end_headers(); return
        requested = self.path.split("?", 1)[0].lstrip("/") or "index.html"
        dist_root = (ROOT / "dist").resolve()
        file_path = (dist_root / requested).resolve()
        if dist_root not in file_path.parents and file_path != dist_root:
            file_path = dist_root / "index.html"
        if not file_path.is_file(): file_path = ROOT / "dist" / "index.html"
        if not file_path.is_file(): self.send_json(404, {"error": "frontend not built"}); return
        body = file_path.read_bytes()
        content_type = "text/html" if file_path.suffix == ".html" else "text/css" if file_path.suffix == ".css" else "application/javascript" if file_path.suffix == ".js" else "application/octet-stream"
        self.send_response(200); self.send_header("Content-Type", content_type); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        if not self.path.startswith("/api/invoke/"): self.send_json(404, {"error": "not found"}); return
        length = int(self.headers.get("Content-Length", "0")); payload = json.loads(self.rfile.read(length) or b"{}")
        try: self.send_json(200, {"result": command(self.path.rsplit("/", 1)[-1], payload)})
        except Exception as error: self.send_json(400, {"error": str(error)})

if __name__ == "__main__":
    db()
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()
