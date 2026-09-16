import concurrent.futures
import csv
import datetime
import io
import json
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    from lxml import etree as _lxml
    _HAS_LXML = True
except ImportError:
    _HAS_LXML = False

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get("DJ_PREP_DATA_DIR", "/data"))
DB_PATH = DATA_DIR / "dj_prep.sqlite"
INBOX_DIR = Path(os.environ.get("DJ_PREP_INBOX_DIR", "/music/inbox"))
ARCHIVE_DIR = Path(os.environ.get("DJ_PREP_ARCHIVE_DIR", "/music/archive"))
LIBRARY_DIR = Path(os.environ.get("DJ_PREP_LIBRARY_DIR", "/music/library"))
REKORDBOX_XML_PATH = os.environ.get("DJ_PREP_REKORDBOX_XML", "")
SOCKSEEK_URL = os.environ.get("SOCKSEEK_URL", "http://sockseek:5030").rstrip("/")
BEETS_URL = os.environ.get("BEETS_URL", "http://beets:8337").rstrip("/")
SOCKSEEK_LOG_FILE = os.environ.get("SOCKSEEK_LOG_FILE", "")
PYTHON = os.environ.get("PYTHON", "python3")
YOUTUBE_CLIENT_ID = os.environ.get("YOUTUBE_CLIENT_ID", "")
YOUTUBE_CLIENT_SECRET = os.environ.get("YOUTUBE_CLIENT_SECRET", "")
YOUTUBE_REDIRECT_URI = os.environ.get("YOUTUBE_REDIRECT_URI", "")
YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube"
YOUTUBE_STATES = {}
LOGS = []
DOWNLOAD_PROGRESS = {}

SCHEMA = """
CREATE TABLE IF NOT EXISTS tracks (
 id INTEGER PRIMARY KEY AUTOINCREMENT, artist TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
 mix_version TEXT, source_url TEXT, import_tag TEXT, state TEXT NOT NULL DEFAULT 'requested', candidate_json TEXT,
 selected_username TEXT, selected_filename TEXT, downloaded_path TEXT, quality_result TEXT,
 quality_notes TEXT, archive_path TEXT, dj_path TEXT, search_job_id TEXT, download_job_id TEXT,
 error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS activities (
 id INTEGER PRIMARY KEY AUTOINCREMENT, track_id INTEGER NOT NULL, from_state TEXT,
 to_state TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS playlists (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, source TEXT NOT NULL DEFAULT 'manual', source_ref TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS playlist_tracks (
 playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
 track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
 position INTEGER NOT NULL DEFAULT 0,
 added_at TEXT NOT NULL DEFAULT (datetime('now')),
 PRIMARY KEY (playlist_id, track_id)
);
CREATE TRIGGER IF NOT EXISTS tracks_updated_at AFTER UPDATE ON tracks FOR EACH ROW
BEGIN UPDATE tracks SET updated_at = datetime('now') WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS tracks_activity_insert AFTER INSERT ON tracks
BEGIN INSERT INTO activities (track_id, to_state) VALUES (NEW.id, NEW.state); END;
CREATE TRIGGER IF NOT EXISTS tracks_activity_state_change AFTER UPDATE OF state ON tracks
WHEN OLD.state <> NEW.state
BEGIN INSERT INTO activities (track_id, from_state, to_state) VALUES (NEW.id, OLD.state, NEW.state); END;
"""

NOISE = re.compile(r"(?i)[\[\(][^\[\(\]\)]*?(official|lyric|hd|hq|4k|video|audio|free\s*download|320kbps)[^\[\(\]\)]*?[\]\)]")
MIX = re.compile(r"(?i)\s*[\(\[]([\w\s\-'&]* (?:original|extended|radio|club|dub|instrumental|vocal|acapella|vip|remix|rmx|mix|edit|version|rework|bootleg|re-?edit|re-?work|re-?mix))[\)\]]\s*$")
EXT = re.compile(r"(?i)\.(mp3|flac|aac|ogg|wav|m4a|aif{1,2}|wma|opus)\s*$")
PREFIX = re.compile(r"^(?:(?:[-*•]\s+)|(?:\d{1,3}(?:[.\):]\s*|\s+-\s+)))+")

_db_migrated = False

def db():
    global _db_migrated
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    if not _db_migrated:
        conn.executescript(SCHEMA)
        try:
            conn.execute("ALTER TABLE tracks ADD COLUMN import_tag TEXT")
            conn.commit()
        except sqlite3.OperationalError:
            pass
        _db_migrated = True
    return conn

def row_json(row):
    return dict(row)

def append_log(message):
    ts = datetime.datetime.now().isoformat(timespec="seconds")
    LOGS.append({"timestamp": ts, "message": message})
    del LOGS[:-300]
    print(f"{ts} {message}", flush=True)

def get_logs():
    if SOCKSEEK_LOG_FILE:
        try:
            return [{"timestamp": "", "message": line} for line in Path(SOCKSEEK_LOG_FILE).read_text(encoding="utf-8", errors="replace").splitlines()[-300:]]
        except OSError:
            pass
    return LOGS

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
    dj_path = None
    if state != "dj_ready":
        xml_path = rekordbox_xml_path()
        if xml_path:
            try:
                location = rekordbox_location(rekordbox_index(xml_path), artist, title)
                if location:
                    dj_path = location
                    state = "dj_ready"
            except Exception:
                pass
    cur = conn.execute("INSERT INTO tracks (artist,title,mix_version,source_url,import_tag,state,error,dj_path) VALUES (?,?,?,?,?,?,?,?)", (artist, title, mix_version, source_url, None, state, error, dj_path))
    row = conn.execute("SELECT * FROM tracks WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.commit()
    conn.close()
    return row_json(row)

def track_exists(artist, title):
    conn = db()
    exists = conn.execute("SELECT EXISTS(SELECT 1 FROM tracks WHERE lower(trim(artist))=lower(trim(?)) AND lower(trim(title))=lower(trim(?)))", (artist, title)).fetchone()[0]
    conn.close()
    return bool(exists)

_rek_cache = {"mtime": None, "index": {}}

def _parse_rekordbox_xml_for_discovery(xml_path):
    tracks_by_id = {}
    if _HAS_LXML:
        try:
            tree = _lxml.parse(xml_path)
            root = tree.getroot()
        except _lxml.XMLSyntaxError as error:
            raise ValueError(f"Cannot read Rekordbox XML: {error}")
    else:
        try:
            tree = ET.parse(xml_path)
            root = tree.getroot()
        except ET.ParseError as error:
            raise ValueError(f"Cannot read Rekordbox XML: {error}")
    for elem in root.iter("TRACK"):
        track_id = elem.get("TrackID")
        if not track_id:
            continue
        tracks_by_id[track_id] = {
            "artist": elem.get("Artist") or "",
            "title": elem.get("Name") or "",
            "mixVersion": elem.get("Mix") or None,
            "location": elem.get("Location") or None,
            "album": elem.get("Album") or None,
            "genre": elem.get("Genre") or None,
            "bpm": elem.get("AverageBpm") or None,
            "key": elem.get("Tonality") or None,
            "rating": elem.get("Rating") or None,
            "playCount": elem.get("PlayCount") or None,
            "dateAdded": elem.get("DateAdded") or None,
            "playlists": [],
            "inLibrary": False,
        }
    def collect_playlists(node):
        has_track_refs = any(child.tag == "TRACK" for child in node)
        if has_track_refs:
            name = node.get("Name") or ""
            for ref in node:
                if ref.tag == "TRACK":
                    key = ref.get("Key")
                    if key and key in tracks_by_id:
                        tracks_by_id[key]["playlists"].append(name)
        else:
            for child in node:
                if child.tag == "NODE":
                    collect_playlists(child)
    playlists_root = root.find("PLAYLISTS")
    if playlists_root is not None:
        for node in playlists_root:
            if node.tag == "NODE":
                collect_playlists(node)
    return list(tracks_by_id.values())

def _parse_rekordbox_xml(xml_path):
    index = {}
    if _HAS_LXML:
        try:
            for _, elem in _lxml.iterparse(xml_path, tag="TRACK"):
                artist = " ".join((elem.get("Artist") or "").split()).casefold()
                title = " ".join((elem.get("Name") or "").split()).casefold()
                index[(artist, title)] = elem.get("Location") or ""
                elem.clear()
        except _lxml.XMLSyntaxError as error:
            raise ValueError(f"Cannot read Rekordbox XML: {error}")
    else:
        try:
            for _, elem in ET.iterparse(xml_path, events=("end",)):
                if elem.tag == "TRACK":
                    artist = " ".join((elem.attrib.get("Artist") or "").split()).casefold()
                    title = " ".join((elem.attrib.get("Name") or "").split()).casefold()
                    index[(artist, title)] = elem.attrib.get("Location") or ""
                    elem.clear()
        except ET.ParseError as error:
            raise ValueError(f"Cannot read Rekordbox XML: {error}")
    return index

def rekordbox_index(xml_path):
    try:
        mtime = Path(xml_path).stat().st_mtime
    except OSError as error:
        raise ValueError(f"Cannot read Rekordbox XML: {error}")
    if _rek_cache["mtime"] == mtime:
        return _rek_cache["index"]
    conn = db()
    stored = conn.execute("SELECT value FROM settings WHERE key='rek_index_mtime'").fetchone()
    stored_mtime = float(stored[0]) if stored else None
    if stored_mtime == mtime:
        blob = conn.execute("SELECT value FROM settings WHERE key='rek_index_blob'").fetchone()
        conn.close()
        if blob:
            index = {(r[0], r[1]): r[2] for r in json.loads(blob[0])}
            _rek_cache.update(mtime=mtime, index=index)
            return index
    conn.close()
    index = _parse_rekordbox_xml(xml_path)
    serialized = json.dumps([[k[0], k[1], v] for k, v in index.items()])
    conn = db()
    conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('rek_index_mtime',?)", (str(mtime),))
    conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('rek_index_blob',?)", (serialized,))
    conn.commit()
    conn.close()
    _rek_cache.update(mtime=mtime, index=index)
    return index

def rekordbox_location(index, artist, title):
    key = (
        " ".join((artist or "").split()).casefold(),
        " ".join((title or "").split()).casefold(),
    )
    return index.get(key) or None

def import_rekordbox_xml(content):
    if not isinstance(content, str) or not content.strip():
        raise ValueError("Rekordbox XML is empty")
    try:
        root = ET.fromstring(content)
    except ET.ParseError as error:
        raise ValueError(f"Invalid Rekordbox XML: {error}")
    if root.tag != "DJ_PLAYLISTS":
        raise ValueError("Invalid Rekordbox XML: root element must be DJ_PLAYLISTS")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / "rekordbox.xml"
    temporary = path.with_suffix(".xml.tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)
    conn = db()
    conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", ("rekordbox_xml_path", str(path)))
    conn.commit()
    conn.close()
    _rek_cache.update(mtime=None, index={})
    return str(path)

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

def list_playlists():
    conn = db()
    rows = conn.execute("SELECT p.*, COUNT(pt.track_id) AS track_count FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id=p.id GROUP BY p.id ORDER BY lower(p.name)").fetchall()
    conn.close()
    return [row_json(row) for row in rows]

def playlist_tracks(playlist_id):
    conn = db()
    rows = conn.execute("SELECT t.* FROM tracks t JOIN playlist_tracks pt ON pt.track_id=t.id WHERE pt.playlist_id=? ORDER BY pt.position, t.id", (playlist_id,)).fetchall()
    conn.close()
    return [row_json(row) for row in rows]

def playlist_id(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValueError("invalid playlist id")

def setting(key, default=""):
    conn = db()
    row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    conn.close()
    return row[0] if row else default

def rekordbox_xml_path():
    return setting("rekordbox_xml_path", REKORDBOX_XML_PATH)

def update(track_id, sql, values):
    conn = db()
    conn.execute(sql, (*values, track_id))
    row = conn.execute("SELECT * FROM tracks WHERE id=?", (track_id,)).fetchone()
    conn.commit()
    conn.close()
    return row_json(row) if row else None

def safe_audio_stem(artist, title):
    value = f"{artist} - {title}" if artist and title else artist or title or "untitled"
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", value)
    return re.sub(r"\s+", " ", value).strip().rstrip(".") or "untitled"

def convert_to_mp3(source_path, artist, title):
    source = Path(source_path)
    if not source.is_file():
        raise ValueError("Downloaded file not found")
    if source.suffix.lower() == ".mp3":
        return str(source)
    output = source.with_name(f"{safe_audio_stem(artist, title)}.mp3")
    ffmpeg = setting("ffmpeg_path", "ffmpeg") or "ffmpeg"
    append_log(f"[ffmpeg] converting: {source.name} → {output.name}")
    result = subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-i", str(source), "-map", "0:a:0", "-map_metadata", "0", "-vn", "-c:a", "libmp3lame", "-b:a", "320k", "-id3v2_version", "3", "-y", str(output)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        raise ValueError(result.stderr.strip() or "ffmpeg conversion failed")
    if not output.is_file() or output.stat().st_size == 0:
        raise ValueError("ffmpeg produced no output file")
    return str(output)

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

def telegram_request(payload):
    api_id = setting("telegram_api_id")
    api_hash = setting("telegram_api_hash")
    if not api_id or not api_hash:
        raise ValueError("Set Telegram API ID and API hash in Settings first")
    session_path = setting("telegram_session_path", str(DATA_DIR / "telegram.session"))
    env = os.environ.copy()
    env["TELEGRAM_API_ID"] = api_id
    env["TELEGRAM_API_HASH"] = api_hash
    env["TELEGRAM_SESSION_PATH"] = session_path
    result = subprocess.run(
        [PYTHON, str(ROOT / "py" / "telegram_fetch.py")],
        input=json.dumps(payload) + "\n",
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    if result.returncode:
        raise ValueError(result.stderr.strip() or "Telegram import failed")
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    if not lines:
        raise ValueError("Telegram helper returned no response")
    return json.loads(lines[-1])

def command(name, payload):
    if name not in {"get_logs", "list_tracks", "list_activity", "list_playlists", "get_playlist_tracks", "create_playlist", "rename_playlist", "delete_playlist", "add_tracks_to_playlist", "remove_tracks_from_playlist", "get_settings", "check_daemon", "list_backups", "search_track", "search_track_loose", "approve_candidate", "start_download", "cancel_download", "check_download_progress", "poll_download", "run_quality_check", "convert_track", "clear_tracks", "import_rekordbox_xml", "import_rekordbox_playlist", "import_text", "import_csv", "import_youtube", "import_telegram", "update_track", "update_track_state", "delete_track", "finish_rekordbox", "tag_track", "get_similar_tracks", "get_similar_tracks_for_query"}:
        append_log(f"[app] {name}")
    if name == "get_logs": return get_logs()
    if name == "list_playlists": return list_playlists()
    if name == "get_playlist_tracks": return playlist_tracks(playlist_id(payload.get("playlistId")))
    if name == "create_playlist":
        playlist_name = (payload.get("name") or "").strip()
        if not playlist_name: raise ValueError("playlist name is required")
        if len(playlist_name) > 120: raise ValueError("playlist name is too long")
        conn = db()
        try:
            cur = conn.execute("INSERT INTO playlists(name,source) VALUES(?,?)", (playlist_name, payload.get("source") or "manual"))
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            raise ValueError("a playlist with that name already exists")
        row = conn.execute("SELECT p.*, 0 AS track_count FROM playlists p WHERE p.id=?", (cur.lastrowid,)).fetchone()
        conn.close()
        return row_json(row)
    if name == "rename_playlist":
        playlist_name = (payload.get("name") or "").strip()
        if not playlist_name: raise ValueError("playlist name is required")
        conn = db()
        try:
            conn.execute("UPDATE playlists SET name=?,updated_at=datetime('now') WHERE id=?", (playlist_name, playlist_id(payload.get("playlistId"))))
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            raise ValueError("a playlist with that name already exists")
        conn.close()
        return None
    if name == "delete_playlist":
        conn = db(); conn.execute("DELETE FROM playlists WHERE id=?", (playlist_id(payload.get("playlistId")),)); conn.commit(); conn.close(); return None
    if name == "add_tracks_to_playlist":
        pid = playlist_id(payload.get("playlistId"))
        ids = [int(value) for value in payload.get("trackIds", [])]
        conn = db()
        current = conn.execute("SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id=?", (pid,)).fetchone()[0] + 1
        for offset, track_id in enumerate(dict.fromkeys(ids)):
            conn.execute("INSERT OR IGNORE INTO playlist_tracks(playlist_id,track_id,position) VALUES(?,?,?)", (pid, track_id, current + offset))
        conn.execute("UPDATE playlists SET updated_at=datetime('now') WHERE id=?", (pid,)); conn.commit(); conn.close(); return None
    if name == "remove_tracks_from_playlist":
        pid = playlist_id(payload.get("playlistId")); ids = [int(value) for value in payload.get("trackIds", [])]
        conn = db(); conn.executemany("DELETE FROM playlist_tracks WHERE playlist_id=? AND track_id=?", [(pid, track_id) for track_id in ids]); conn.execute("UPDATE playlists SET updated_at=datetime('now') WHERE id=?", (pid,)); conn.commit(); conn.close(); return None
    if name == "get_settings":
        conn = db()
        values = {row["key"]: row["value"] for row in conn.execute("SELECT key,value FROM settings")}
        conn.close()
        return {"sockseekPath": "", "sockseekDaemonUrl": values.get("sockseek_daemon_url", SOCKSEEK_URL), "prepInboxDir": str(INBOX_DIR), "musicLibraryDir": str(LIBRARY_DIR), "picardPath": "", "ffmpegPath": "", "rekordboxImportDir": str(ARCHIVE_DIR), "rekordboxXmlPath": values.get("rekordbox_xml_path", REKORDBOX_XML_PATH), "pythonPath": PYTHON, "ytCookiesFile": values.get("yt_cookies_file", ""), "setupComplete": values.get("setup_complete") == "true", "hasSockseekCredentials": bool(values.get("sockseek_username") and values.get("sockseek_password")), "hasSpotifyCredentials": bool(values.get("spotify_client_id") and values.get("spotify_client_secret")), "hasCosineCredentials": bool(values.get("cosine_api_key")), "hasTelegramCredentials": bool(values.get("telegram_api_id") and values.get("telegram_api_hash")), "hasTelegramSession": Path(values.get("telegram_session_path", str(DATA_DIR / "telegram.session"))).exists(), "pathMapFrom": values.get("path_map_from", ""), "pathMapTo": values.get("path_map_to", ""), "beetsUrl": values.get("beets_url", "")}
    if name == "save_settings":
        payload = payload.get("payload", payload)
        conn = db()
        mapping = {"sockseekDaemonUrl": "sockseek_daemon_url", "rekordboxXmlPath": "rekordbox_xml_path", "setupComplete": "setup_complete", "sockseekUsername": "sockseek_username", "sockseekPassword": "sockseek_password", "spotifyClientId": "spotify_client_id", "spotifyClientSecret": "spotify_client_secret", "cosineApiKey": "cosine_api_key", "telegramApiId": "telegram_api_id", "telegramApiHash": "telegram_api_hash", "telegramSessionPath": "telegram_session_path", "pathMapFrom": "path_map_from", "pathMapTo": "path_map_to", "ytCookiesFile": "yt_cookies_file", "beetsUrl": "beets_url"}
        for key, value in payload.items():
            if key in mapping and value is not None:
                conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (mapping[key], str(value).lower() if isinstance(value, bool) else value))
        conn.commit(); conn.close(); return None
    if name == "import_rekordbox_xml":
        return import_rekordbox_xml(payload.get("content", ""))
    if name == "check_rekordbox":
        xml_path = payload.get("xmlPath") or rekordbox_xml_path()
        if not xml_path:
            raise ValueError("Rekordbox XML path is not configured")
        xml_tracks = _parse_rekordbox_xml_for_discovery(xml_path)
        pipeline = tracks()
        pipeline_keys = {
            (" ".join((t["artist"] or "").split()).casefold(), " ".join((t["title"] or "").split()).casefold())
            for t in pipeline
        }
        for t in xml_tracks:
            artist_key = " ".join((t["artist"] or "").split()).casefold()
            title_key = " ".join((t["title"] or "").split()).casefold()
            t["inLibrary"] = (artist_key, title_key) in pipeline_keys
        return {"tracksInXml": xml_tracks}
    if name == "import_rekordbox_playlist":
        inserted = []
        for t in payload.get("tracks", []):
            artist = t.get("artist", "")
            title = t.get("title", "")
            mix_version = t.get("mixVersion") or None
            location = t.get("location") or None
            if not artist and not title:
                continue
            if track_exists(artist, title):
                continue
            conn = db()
            existing = conn.execute("SELECT * FROM tracks WHERE lower(trim(artist))=lower(trim(?)) AND lower(trim(title))=lower(trim(?)) LIMIT 1", (artist, title)).fetchone()
            if existing:
                row = existing
            else:
                cur = conn.execute("INSERT INTO tracks (artist,title,mix_version,source_url,import_tag,state,dj_path) VALUES (?,?,?,'rekordbox://library','Rekordbox','dj_ready',?)", (artist, title, mix_version, location))
                row = conn.execute("SELECT * FROM tracks WHERE id=?", (cur.lastrowid,)).fetchone()
            playlist_names = [str(value).strip() for value in t.get("playlists", []) if str(value).strip()]
            for playlist_name in playlist_names:
                conn.execute("INSERT OR IGNORE INTO playlists(name,source,source_ref) VALUES(?, 'rekordbox', ?)", (playlist_name, playlist_name))
                pid = conn.execute("SELECT id FROM playlists WHERE name=?", (playlist_name,)).fetchone()[0]
                position = conn.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_id=?", (pid,)).fetchone()[0]
                conn.execute("INSERT OR IGNORE INTO playlist_tracks(playlist_id,track_id,position) VALUES(?,?,?)", (pid, row["id"], position))
            conn.commit(); conn.close()
            inserted.append(row_json(row))
        append_log(f"[import] Rekordbox playlist: {len(inserted)} track(s) added as dj_ready")
        return inserted
    if name == "finish_rekordbox":
        track = get_track(int(payload["trackId"]))
        dj_path = track.get("dj_path")
        xml_path = rekordbox_xml_path()
        if xml_path:
            dj_path = rekordbox_location(rekordbox_index(xml_path), track["artist"], track["title"]) or dj_path
        append_log(f"[rekordbox] marked imported: {track['artist']} - {track['title']}")
        return update(track["id"], "UPDATE tracks SET dj_path=?, state='dj_ready', error=NULL WHERE id=?", (dj_path,))
    if name in ("import_text", "import_csv"):
        content = payload.get("text", "") if name == "import_text" else payload.get("content", "")
        inserted = [insert(draft) for draft in (parse_text(content) if name == "import_text" else parse_csv(content))]
        append_log(f"[import] {'text' if name == 'import_text' else 'CSV'}: {len(inserted)} track(s) added")
        return inserted
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
        inserted = [insert((draft.get("artist", ""), draft.get("title", ""), draft.get("mix_version"), draft.get("source_url"), draft.get("state", "needs_review"), draft.get("notes"))) for draft in (json.loads(line) for line in result.stdout.splitlines() if line.strip())]
        append_log(f"[import] YouTube: {len(inserted)} track(s) added from {url}")
        return inserted
    if name == "telegram_login_start":
        return telegram_request({"action": "login_start", "phone": payload.get("phone", "")}).get("status")
    if name == "telegram_login_code":
        return telegram_request({"action": "login_code", "code": payload.get("code", ""), "password": payload.get("password")}).get("status")
    if name == "telegram_check":
        return telegram_request({"action": "check"}).get("status")
    if name == "telegram_fetch_links":
        return telegram_request({"action": "fetch", "channel_id": payload.get("channelId", ""), "limit": max(1, min(int(payload.get("limit", 100)), 1000))}).get("messages", [])
    if name == "import_telegram_link":
        url = payload.get("url", "")
        result = subprocess.run([PYTHON, str(ROOT / "py" / "yt_fetch.py"), url], capture_output=True, text=True, env=os.environ.copy(), check=False)
        if result.returncode:
            raise ValueError(result.stderr.strip() or "YouTube metadata failed")
        message_url = payload.get("messageUrl") or url
        rows = []
        for line in result.stdout.splitlines():
            if not line.strip():
                continue
            draft = json.loads(line)
            artist = draft.get("artist", "")
            title = draft.get("title", "")
            if track_exists(artist, title):
                continue
            rows.append(insert((artist, title, draft.get("mix_version"), message_url, draft.get("state", "needs_review"), draft.get("notes"))))
        import_tag = payload.get("importTag") or "Telegram"
        conn = db()
        for row in rows:
            conn.execute("UPDATE tracks SET import_tag=? WHERE id=?", (import_tag, row["id"]))
            row["import_tag"] = import_tag
        conn.commit(); conn.close()
        return rows
    if name == "import_telegram":
        messages = telegram_request({"action": "fetch", "channel_id": payload.get("channelId", ""), "limit": max(1, min(int(payload.get("limit", 100)), 1000))}).get("messages", [])
        script = ROOT / "py" / "yt_fetch.py"

        def fetch_message(message):
            url = message.get("url", "")
            result = subprocess.run([PYTHON, str(script), url], capture_output=True, text=True, env=os.environ.copy(), check=False)
            return message, url, result

        added = []
        skipped = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            for message, url, result in pool.map(fetch_message, messages):
                if result.returncode:
                    skipped.append(f"{url}: {result.stderr.strip() or 'YouTube metadata failed'}")
                    continue
                for line in result.stdout.splitlines():
                    if line.strip():
                        draft = json.loads(line)
                        artist = draft.get("artist", "")
                        title = draft.get("title", "")
                        if track_exists(artist, title):
                            skipped.append(f"{artist} - {title}: already in library")
                            continue
                        added.append(insert((artist, title, draft.get("mix_version"), message.get("message_url") or draft.get("source_url") or url, draft.get("state", "needs_review"), draft.get("notes"))))
        return {"tracks": added, "skipped": skipped}
    if name == "list_tracks": return tracks(payload.get("state"))
    if name == "list_activity":
        limit = max(1, min(int(payload.get("limit", 30)), 100))
        conn = db()
        rows = conn.execute("SELECT a.id,a.track_id,coalesce(t.artist,''),coalesce(t.title,''),a.from_state,a.to_state,a.created_at FROM activities a LEFT JOIN tracks t ON t.id=a.track_id ORDER BY a.id DESC LIMIT ?", (limit,)).fetchall()
        conn.close()
        return [{"id": row[0], "trackId": row[1], "artist": row[2], "title": row[3], "fromState": row[4], "toState": row[5], "createdAt": row[6]} for row in rows]
    if name == "update_track_state":
        track = get_track(int(payload["id"]))
        result = update(track["id"], "UPDATE tracks SET state=? WHERE id=?", (payload["state"],))
        append_log(f"[state] {track['artist']} - {track['title']}: {track['state']} → {payload['state']}")
        return result
    if name == "delete_track":
        track = get_track(int(payload["id"]))
        conn = db(); conn.execute("DELETE FROM tracks WHERE id=?", (payload["id"],)); conn.commit(); conn.close()
        append_log(f"[delete] removed: {track['artist']} - {track['title']} (was {track['state']})")
        return None
    if name == "clear_tracks":
        conn = db()
        conn.execute("DELETE FROM activities")
        conn.execute("DELETE FROM tracks")
        conn.commit(); conn.close()
        append_log("[library] reset complete: tracks and activity history cleared")
        return None
    if name == "update_track":
        before = get_track(int(payload["id"]))
        result = update(before["id"], "UPDATE tracks SET artist=?,title=?,mix_version=?,state=CASE WHEN state='needs_review' AND ?<>'' AND ?<>'' THEN 'requested' ELSE state END WHERE id=?", (payload["artist"], payload["title"], payload.get("mixVersion"), payload["artist"], payload["title"]))
        append_log(f"[edit] track {before['id']}: '{before['artist']} - {before['title']}' → '{payload['artist']} - {payload['title']}'")
        return result
    if name in ("search_track", "search_track_loose"):
        track = get_track(int(payload["trackId"]))
        label = f'{track["artist"]} - {track["title"]}'
        harder = name == "search_track_loose"
        append_log(f"[search] started: {label} ({'harder' if harder else 'normal'})")
        body = {
            "songQuery": {
                "artist": track["artist"],
                "title": track["title"],
                "artistMaybeWrong": harder,
            }
        }
        if harder:
            body["options"] = {"downloadSettings": {"desperateSearch": True}}
        try:
            job = request("POST", "/api/jobs/search/tracks", body)["jobId"]
        except Exception as error:
            append_log(f"[search] failed to start: {label}: {error}")
            raise
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
            append_log(f"[search] completed: {label}: {len(ranked)} candidates")
        else:
            update(track["id"], "UPDATE tracks SET state='requested',error=? WHERE id=?", ("No results found — try editing the artist/title or search again later",))
            append_log(f"[search] completed: {label}: no results")
        return ranked
    if name == "approve_candidate":
        track = get_track(int(payload["trackId"]))
        result = update(track["id"], "UPDATE tracks SET selected_username=?,selected_filename=?,state='approved' WHERE id=?", (payload["username"], payload["filename"]))
        fname = Path(payload["filename"]).name
        append_log(f"[review] approved: {track['artist']} - {track['title']} → {fname} (from {payload['username']})")
        return result
    if name == "start_download":
        track = get_track(int(payload["trackId"]))
        if not track.get("search_job_id") or not track.get("selected_username") or not track.get("selected_filename"): raise ValueError("Approve a candidate before downloading")
        try:
            result = request("POST", f'/api/jobs/{track["search_job_id"]}/downloads/files', {"files": [{"username": track["selected_username"], "filename": track["selected_filename"]}]})
        except urllib.error.HTTPError as e:
            if e.code == 404:
                append_log(f"[download] search job expired (sockseek restarted?): {track['artist']} - {track['title']}")
                return update(track["id"], "UPDATE tracks SET state='requested',search_job_id=NULL,selected_username=NULL,selected_filename=NULL,error=? WHERE id=?", ("Search job expired — sockseek may have restarted. Re-search to continue.",))
            raise
        job = result[0].get("jobId", "") if isinstance(result, list) and result else ""
        append_log(f"[download] started: {track['artist']} - {track['title']}")
        return update(track["id"], "UPDATE tracks SET download_job_id=?,state='downloading' WHERE id=?", (job,))
    if name == "cancel_download":
        track = get_track(int(payload["trackId"]))
        job_id = track.get("download_job_id")
        if not job_id:
            raise ValueError("track has no download job")
        request("POST", f"/api/jobs/{job_id}/cancel")
        append_log(f"[download] cancelled: {track['artist']} - {track['title']}")
        return update(track["id"], "UPDATE tracks SET state='failed',error=? WHERE id=?", ("Download cancelled by user",))
    if name == "check_download_progress":
        track = get_track(int(payload["trackId"]))
        name_part = Path(track.get("selected_filename") or "").name
        found = next((path for path in (INBOX_DIR / name_part, INBOX_DIR / (name_part + ".part"), INBOX_DIR / (name_part + ".incomplete"), INBOX_DIR / (name_part + ".tmp")) if path.exists()), None)
        total = next((item["candidate"].get("size") for item in json.loads(track.get("candidate_json") or "[]") if Path(item["candidate"].get("filename", "")).name.lower() == name_part.lower()), None)
        bytes_on_disk = found.stat().st_size if found else None
        progress = (bytes_on_disk, total)
        if DOWNLOAD_PROGRESS.get(track["id"]) != progress:
            DOWNLOAD_PROGRESS[track["id"]] = progress
            if bytes_on_disk is not None and total:
                append_log(f"[download] progress: {track['artist']} - {track['title']}: {bytes_on_disk}/{total} bytes")
        return {"bytesOnDisk": bytes_on_disk, "bytesTotal": total}
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
            added_video = False
            for attempt in range(2):
                try:
                    youtube_request("https://youtube.googleapis.com/youtube/v3/playlistItems?part=snippet", token, {"snippet": {"playlistId": playlist["id"], "resourceId": {"kind": "youtube#video", "videoId": video_id}}})
                    added_video = True
                    break
                except (urllib.error.HTTPError, urllib.error.URLError):
                    if attempt == 0:
                        time.sleep(0.3)
            if added_video:
                added += 1
            else:
                skipped.append(video_id)
        return {"playlistUrl": f"https://www.youtube.com/playlist?list={playlist['id']}", "added": added, "skipped": skipped}
    if name == "poll_download":
        track = get_track(int(payload["trackId"]))
        expected = Path(track.get("selected_filename") or "").name
        for _ in range(120):
            found = next((path for path in INBOX_DIR.iterdir() if path.name.lower() == expected.lower()), None) if INBOX_DIR.exists() else None
            if found:
                append_log(f"[download] completed: {track['artist']} - {track['title']}")
                return update(track["id"], "UPDATE tracks SET downloaded_path=?,state='downloaded' WHERE id=?", (str(found),))["downloaded_path"]
            time.sleep(5)
        append_log(f"[download] timed out: {track['artist']} - {track['title']}")
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
        detail = quality.get("notes") or ("fake FLAC" if state == "quality_failed" else "passed")
        append_log(f"[quality] {track['artist']} - {track['title']}: {detail}")
        return {"isRealFlac": quality.get("is_real_flac"), "sampleRate": None, "bitDepth": None, "channels": None, "durationSecs": None, "spectralCutoffHz": None, "notes": quality.get("notes", "")}
    if name == "convert_track":
        track = get_track(int(payload["trackId"]))
        source = track.get("downloaded_path")
        if not source:
            raise ValueError("No downloaded file — run poll_download first")
        mp3_path = convert_to_mp3(source, track["artist"], track["title"])
        append_log(f"[convert] completed: {track['artist']} - {track['title']}")
        return update(track["id"], "UPDATE tracks SET downloaded_path=?,state='converted',quality_result=NULL,quality_notes=NULL,error=NULL WHERE id=?", (mp3_path,))
    if name in ("get_similar_tracks", "get_similar_tracks_for_query"):
        if name == "get_similar_tracks":
            track = get_track(int(payload["trackId"]))
            artist, title = track["artist"], track["title"]
        else:
            artist, title = payload.get("artist", ""), payload.get("title", "")
        key = setting("cosine_api_key")
        if not key: raise ValueError("cosine_api_key not configured — add it in Settings")
        env = os.environ.copy(); env["COSINE_API_KEY"] = key
        append_log(f"[similar] looking up: {artist} - {title}")
        result = subprocess.run([PYTHON, str(ROOT / "py" / "cosine_fetch.py"), artist, title], capture_output=True, text=True, env=env, check=False)
        if result.returncode: raise ValueError(result.stderr.strip() or "Similarity lookup failed")
        items = [{"artist": item.get("artist", ""), "title": item.get("title", ""), "mixVersion": item.get("mix_version"), "videoUrl": item.get("video_url"), "cosineId": item.get("cosine_id", ""), "score": item.get("score", 0)} for item in (json.loads(line) for line in result.stdout.splitlines() if line.strip())]
        append_log(f"[similar] {artist} - {title}: {len(items)} result(s)")
        return items
    if name == "tag_track":
        track = get_track(int(payload["trackId"]))
        source = track.get("downloaded_path")
        if not source: raise ValueError("No downloaded file — run poll_download first")
        append_log(f"[beets] importing: {track['artist']} - {track['title']}")
        beets_url = setting("beets_url", BEETS_URL).rstrip("/")
        req_body = json.dumps({"path": source}).encode()
        req = urllib.request.Request(f"{beets_url}/import", data=req_body, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                result = json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            result = json.loads(exc.read())
        if not result.get("ok"):
            raise ValueError(result.get("output") or "beets import failed")
        output_line = next((l for l in result.get("output", "").splitlines() if "/music/archive" in l), None)
        tagged_path = output_line.strip() if output_line else str(Path(source).with_suffix(".mp3"))
        append_log(f"[beets] done: {track['artist']} - {track['title']} → {Path(tagged_path).name}")
        return update(track["id"], "UPDATE tracks SET archive_path=?,state='ready_for_rekordbox',error=NULL WHERE id=?", (tagged_path,))
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
            if name == "Prep inbox" and exists:
                free_gb = shutil.disk_usage(path).free // (1024 ** 3)
                checks.append({"name": "Free storage", "ok": free_gb >= 5, "detail": f"{free_gb} GB available"})
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
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        self.end_headers()
        self.wfile.write(body)
    def do_POST(self):
        if not self.path.startswith("/api/invoke/"): self.send_json(404, {"error": "not found"}); return
        length = int(self.headers.get("Content-Length", "0")); payload = json.loads(self.rfile.read(length) or b"{}")
        name = self.path.rsplit("/", 1)[-1]
        try: self.send_json(200, {"result": command(name, payload)})
        except Exception as error:
            append_log(f"[error] {name}: {error}")
            self.send_json(400, {"error": str(error)})

if __name__ == "__main__":
    conn = db()
    conn.execute("PRAGMA journal_mode=WAL")
    conn.close()
    xml_path = rekordbox_xml_path()
    if xml_path:
        threading.Thread(target=rekordbox_index, args=(xml_path,), daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()
