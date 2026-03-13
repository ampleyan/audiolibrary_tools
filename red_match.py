"""
red_match.py
------------
Match a local music folder against Redacted.sh (RED) torrents.
If local files match a RED torrent's file list (by size + name), renames
local files to RED's exact filenames, then injects the torrent into
qBittorrent for cross-seeding.

Workflow:
  1. Point LOCAL_FOLDER at a single album folder (or a staging dir of many)
  2. Script searches RED for matching releases by artist + album
  3. For each RED torrent candidate, matches local files by size (then name)
  4. Prints a rename overview table — shows every proposed change
  5. On confirmation: renames files, renames folder to torrent root name,
     downloads .torrent, injects into qBittorrent with skip-check

Requirements:
  pip install requests mutagen rapidfuzz qbittorrent-api

Usage:
  python red_match.py                        # processes LOCAL_FOLDER
  python red_match.py "Z:\\path\\to\\folder" # override folder from CLI
"""

# ─── CONFIG ───────────────────────────────────────────────────────────────────

RED_API_KEY    = "4dbb8953.c44b57d5f7349e80a13a01e6762fe584"                      # RED > Profile > Security > API Keys
RED_PASSKEY    = "36f18a11cb74306dc29c14719a62769d"              # RED > Profile > Security > Passkey (needed for upload torrent announce URL)
RED_BASE_URL   = "https://redacted.sh"

QBT_HOST       = "http://kodisrv:8080"  # qBittorrent Web UI on kodisrv
QBT_USERNAME   = "ampleyan"
QBT_PASSWORD   = "Xus70aiaf71"

LOCAL_FOLDER   = r"D:\MUSIC\REDACTED"   # folder to process (single album or dir of albums)
TORRENT_DIR    = r"D:\MUSIC\TORRENTS"   # where downloaded .torrent files are saved
DEST_DIR       = r"D:\MUSIC\REDACTED"   # where matched+renamed folders land (same = rename in-place)
UPLOAD_DIR     = r"D:\MUSIC\UPLOAD_CANDIDATES"  # where upload candidate info files are written
PUBLIC_DL_DIR        = r"/mnt/media/MUSIC/REDACTED/TO_COMPLETE"        # fresh full-album downloads land here
COMPLETION_LOG_FILE  = r"/mnt/media/MUSIC/REDACTED/completion_log.json" # tracks original vs redownloaded albums

# Prowlarr — used to search public trackers when local file count < RED torrent count.
# Leave empty to skip public tracker search.
PROWLARR_URL     = "http://kodisrv:9696"   # Prowlarr Web UI
PROWLARR_API_KEY = "784837cfcf9e47dab431c0acdb59fcb9"                       # Prowlarr Settings > General > API Key

# RED API result cache — reuse dry-run results on the real run without re-querying.
# Stores search results + torrent file lists, invalidated by local audio file mtimes.
# Set to '' to disable.  Delete the file to force a fresh query.
MATCH_CACHE_FILE = r"D:\MUSIC\red_match_cache.json"

# Folders to skip — any folder whose name contains one of these strings (case-insensitive)
# is ignored entirely (exact match OR substring).
SKIP_FOLDERS = {
    'complete', 'downloading', 'new', 'onlyraretracks', 'FAKES',
    'FOLDERS TO CHECK', 'IN PROGRESS', 'REV', 'Sort 2 Single Trax',
    'New folder (2)', 'MUSIC', 'CHECK', 'oef', 'soulseek_batch_tracks',
    'Roxy lijst 1',
}

SIZE_TOLERANCE  = 0.005  # 0.5% — files within this size delta are considered same
MIN_NAME_SIM    = 0.55   # minimum similarity score (0-1) for name-only fallback match
DRY_RUN        = False    # True = show plan only, False = rename + inject

# ─── END CONFIG ───────────────────────────────────────────────────────────────

import os, re, sys, time, shutil, json
from difflib import SequenceMatcher
from pathlib import Path
from collections import defaultdict

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

import requests
try:
    from rapidfuzz import fuzz as rfuzz
    USE_RAPIDFUZZ = True
except ImportError:
    USE_RAPIDFUZZ = False

from musiclib import AUDIO_EXT, get_fmt, read_metadata

# RED format strings → local fmt prefix mapping for pre-filtering
_RED_FMT_MAP = {
    'MP3': 'MP3',
    'FLAC': 'FLAC',
    'AAC': 'AAC',
    'AC3': 'AC3',
    'DTS': 'DTS',
}

# ─── CACHE ───────────────────────────────────────────────────────────────────

def _load_match_cache():
    """Load cached RED API results. Returns {} if disabled, absent, or unreadable."""
    if not MATCH_CACHE_FILE:
        return {}
    p = Path(MATCH_CACHE_FILE)
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_bytes().decode('utf-8'))
        print(f"  Cache: {len(data)} folder entries loaded from {MATCH_CACHE_FILE}")
        return data
    except Exception as e:
        print(f"  Cache load failed ({e}), starting fresh.")
        return {}


def _save_match_cache(cache):
    """Persist cache to MATCH_CACHE_FILE."""
    if not MATCH_CACHE_FILE:
        return
    try:
        Path(MATCH_CACHE_FILE).write_bytes(
            json.dumps(cache, ensure_ascii=False, indent=2).encode('utf-8')
        )
    except Exception as e:
        print(f"  Cache save failed: {e}")


# ─── RED API ─────────────────────────────────────────────────────────────────

class RedAPI:
    def __init__(self, api_key, base_url):
        self.session = requests.Session()
        self.session.headers.update({'Authorization': api_key})
        self.base_url = base_url.rstrip('/')
        self._last_req = 0.0

    def _get(self, path, params):
        # Throttle: RED allows 5 requests per 10s → minimum 2s between requests
        elapsed = time.time() - self._last_req
        if elapsed < 2.1:
            time.sleep(2.1 - elapsed)
        r = self.session.get(f"{self.base_url}{path}", params=params, timeout=15)
        self._last_req = time.time()
        r.raise_for_status()
        data = r.json()
        if data.get('status') != 'success':
            raise RuntimeError(f"RED API error: {data.get('error', data)}")
        return data['response']

    def search(self, artist='', album='', year=''):
        """Return list of torrent groups matching artist+album."""
        params = {'action': 'browse'}
        if artist:
            params['artistname'] = artist
        if album:
            params['groupname'] = album
        return self._get('/ajax.php', params).get('results', [])

    def get_torrent(self, torrent_id):
        """Return full torrent details including file list."""
        return self._get('/ajax.php', {'action': 'torrent', 'id': torrent_id})

    def get_group(self, group_id):
        """Return full torrent group with ALL torrents (search results may omit some)."""
        return self._get('/ajax.php', {'action': 'torrentgroup', 'id': group_id})

    def download_torrent(self, torrent_id, dest_path):
        """
        Download .torrent file to dest_path (Path object).

        Tries Authorization header first (requires 'Torrents' API key permission).
        Falls back to passkey in URL if RED_PASSKEY is set and the first attempt
        returns 401 — useful when the API key lacks download permission.
        """
        elapsed = time.time() - self._last_req
        if elapsed < 2.1:
            time.sleep(2.1 - elapsed)

        params = {'action': 'download', 'id': torrent_id}
        r = self.session.get(
            f"{self.base_url}/torrents.php", params=params, timeout=30
        )
        self._last_req = time.time()

        if r.status_code == 401:
            # Try auth as query param (RED alternative to Authorization header)
            for extra in ({'auth': RED_API_KEY}, {'torrent_pass': RED_PASSKEY} if RED_PASSKEY else {}):
                if not extra:
                    continue
                elapsed = time.time() - self._last_req
                if elapsed < 2.1:
                    time.sleep(2.1 - elapsed)
                r = self.session.get(
                    f"{self.base_url}/torrents.php",
                    params={**params, **extra},
                    timeout=30,
                )
                self._last_req = time.time()
                if r.status_code != 401:
                    break

        r.raise_for_status()
        dest_path.write_bytes(r.content)


def parse_red_filelist(filelist_str):
    """
    Parse RED file list string into [(filename, size_bytes), ...].
    RED format: "name1{{{size1}}}|||name2{{{size2}}}"
    """
    files = []
    for entry in filelist_str.split('|||'):
        entry = entry.strip()
        if not entry:
            continue
        m = re.match(r'^(.+)\{\{\{(\d+)\}\}\}$', entry)
        if m:
            files.append((m.group(1).strip(), int(m.group(2))))
    return files


# ─── MATCHING ────────────────────────────────────────────────────────────────

def name_similarity(a, b):
    """Normalised similarity between two filenames (stems only, no track nums)."""
    def norm(s):
        s = Path(s).stem
        s = re.sub(r'^\d+[\s\-_.]+', '', s)   # strip leading track number
        s = re.sub(r'[^\w\s]', ' ', s)
        return s.lower().strip()
    a, b = norm(a), norm(b)
    if USE_RAPIDFUZZ:
        return rfuzz.token_sort_ratio(a, b) / 100.0
    return SequenceMatcher(None, a, b).ratio()


def match_files(local_paths, red_files, size_tol=SIZE_TOLERANCE):
    """
    Match local audio files to RED torrent file entries.

    Args:
        local_paths: list of Path objects (local audio files)
        red_files:   list of (red_filename, red_size) for audio files only

    Returns:
        (matches, problems)
        matches:  list of {local, red_name, red_size, local_size, conf, size_diff_pct}
        problems: list of human-readable problem strings (empty = perfect match)
    """
    if len(local_paths) != len(red_files):
        return [], [
            f"File count mismatch: local={len(local_paths)}, RED={len(red_files)}"
        ]

    local_info = [(p, p.stat().st_size) for p in local_paths]
    remaining_red = list(red_files)   # mutable copy
    matches = []
    problems = []

    # Sort both by size to speed up lookup
    local_sorted = sorted(local_info, key=lambda x: x[1])

    for local_path, local_size in local_sorted:
        # 1. Find RED candidates within size tolerance
        size_candidates = [
            (rf, rs, abs(local_size - rs) / max(local_size, 1))
            for rf, rs in remaining_red
            if abs(local_size - rs) / max(local_size, 1) <= size_tol
        ]

        if len(size_candidates) == 1:
            rf, rs, diff = size_candidates[0]
            sim = name_similarity(local_path.name, rf)
            conf = 'size' if sim < 0.4 else 'size+name'
            matches.append({
                'local': local_path,
                'red_name': rf,
                'red_size': rs,
                'local_size': local_size,
                'conf': conf,
                'size_diff_pct': diff * 100,
                'name_sim': sim,
            })
            remaining_red.remove((rf, rs))

        elif len(size_candidates) > 1:
            # Multiple size matches — use name similarity as tiebreaker
            best = max(size_candidates,
                       key=lambda x: name_similarity(local_path.name, x[0]))
            rf, rs, diff = best
            sim = name_similarity(local_path.name, rf)
            matches.append({
                'local': local_path,
                'red_name': rf,
                'red_size': rs,
                'local_size': local_size,
                'conf': f'size+name:{sim:.0%}',
                'size_diff_pct': diff * 100,
                'name_sim': sim,
            })
            remaining_red.remove((rf, rs))

        else:
            # No size match — fall back to name-only
            name_scores = [
                (rf, rs, name_similarity(local_path.name, rf))
                for rf, rs in remaining_red
            ]
            best = max(name_scores, key=lambda x: x[2]) if name_scores else None
            if best and best[2] >= MIN_NAME_SIM:
                rf, rs, sim = best
                size_diff = abs(local_size - rs) / max(local_size, 1) * 100
                matches.append({
                    'local': local_path,
                    'red_name': rf,
                    'red_size': rs,
                    'local_size': local_size,
                    'conf': f'name:{sim:.0%}',
                    'size_diff_pct': size_diff,
                    'name_sim': sim,
                })
                remaining_red.remove((rf, rs))
            else:
                problems.append(
                    f"No match for: {local_path.name}  "
                    f"(best name: {best[0] if best else '—'} @ {best[2]:.0%})"
                    if best else f"No match for: {local_path.name}"
                )

    return matches, problems


# ─── FOLDER PARSING ──────────────────────────────────────────────────────────

def parse_folder_name(folder_name):
    """Try to extract (artist, album, year) from 'Artist - Album (Year) - Fmt'."""
    m = re.match(
        r'^(.+?)\s+-\s+(.+?)\s+\((\d{4})\)',
        folder_name
    )
    if m:
        return m.group(1).strip(), m.group(2).strip(), m.group(3)
    # No year in parens — try without
    m = re.match(r'^(.+?)\s+-\s+(.+)', folder_name)
    if m:
        return m.group(1).strip(), m.group(2).strip(), ''
    return '', folder_name, ''


def read_folder_tags(folder_path):
    """Return (artist, album, year) from the first readable audio file in folder."""
    for p in sorted(Path(folder_path).iterdir()):
        if p.is_file() and p.suffix.lower() in AUDIO_EXT:
            m = read_metadata(p)
            if m['artist'] or m['album']:
                return m['artist'], m['album'], m['year']
    return '', '', ''


# ─── DISPLAY ─────────────────────────────────────────────────────────────────

def print_rename_table(matches, folder_path, torrent_root, torrent_info):
    """Print the proposed rename overview to stdout."""
    tw = 72

    print()
    print('=' * tw)
    print(f"  RED MATCH: {torrent_info}")
    print('=' * tw)

    # Folder rename
    local_folder_name = Path(folder_path).name
    if torrent_root and torrent_root != local_folder_name:
        print(f"\n  FOLDER RENAME:")
        print(f"    FROM: {local_folder_name}")
        print(f"    TO:   {torrent_root}")
    else:
        print(f"\n  FOLDER: {local_folder_name}  (no rename needed)")

    # File renames
    print(f"\n  FILE RENAMES ({len(matches)} files):\n")
    col = 46
    header = f"  {'LOCAL FILE':<{col}}  {'RED FILENAME':<{col}}  CONF"
    print(header)
    print('  ' + '-' * (len(header) - 2))

    needs_rename = 0
    for m in sorted(matches, key=lambda x: x['red_name']):
        local_name = m['local'].name
        red_name   = Path(m['red_name']).name   # strip any subpath
        changed    = local_name != red_name
        if changed:
            needs_rename += 1
        marker = '→' if changed else '='
        size_note = f"  Δsize={m['size_diff_pct']:.2f}%" if m['size_diff_pct'] > 0.01 else ''
        print(f"  {local_name:<{col}}  {marker} {red_name:<{col-2}}  {m['conf']}{size_note}")

    print()
    print(f"  Files to rename: {needs_rename} / {len(matches)}")
    print('=' * tw)


# ─── QBITTORRENT ─────────────────────────────────────────────────────────────

def inject_torrent(torrent_path, save_path, skip_check=True):
    """
    Add .torrent to qBittorrent.
    skip_check=True  → cross-seed (files already present, skip hash check)
    skip_check=False → public completion (download missing files)
    """
    try:
        import qbittorrentapi
    except ImportError:
        print("  WARNING: qbittorrent-api not installed. Skipping inject.")
        print("           Run: pip install qbittorrent-api")
        return False

    host, *port_part = QBT_HOST.replace('http://', '').split(':')
    port = int(port_part[0]) if port_part else 8080

    category = 'red-crossseed' if skip_check else 'red-completion'

    try:
        client = qbittorrentapi.Client(
            host=host, port=port,
            username=QBT_USERNAME, password=QBT_PASSWORD
        )
        client.auth_log_in()
        with open(torrent_path, 'rb') as f:
            client.torrents_add(
                torrent_files=f,
                save_path=str(save_path),
                is_skip_checking=skip_check,
                category=category,
            )
        client.auth_log_out()
        print(f"  Injected into qBittorrent: save_path={save_path}  skip_check={skip_check}")
        return True
    except Exception as e:
        print(f"  ERROR injecting torrent: {e}")
        return False


# ─── PUBLIC TRACKER COMPLETION ───────────────────────────────────────────────

def _bdecode(data, idx=0):
    """Minimal bencode decoder. Returns (value, next_idx)."""
    b = data[idx]
    if b == ord('i'):
        end = data.index(ord('e'), idx + 1)
        return int(data[idx + 1:end]), end + 1
    elif b == ord('l'):
        idx += 1
        result = []
        while data[idx] != ord('e'):
            val, idx = _bdecode(data, idx)
            result.append(val)
        return result, idx + 1
    elif b == ord('d'):
        idx += 1
        result = {}
        while data[idx] != ord('e'):
            key, idx = _bdecode(data, idx)
            val, idx = _bdecode(data, idx)
            result[key] = val
        return result, idx + 1
    else:
        colon = data.index(ord(':'), idx)
        length = int(data[idx:colon])
        start = colon + 1
        return data[start:start + length], start + length


def _parse_torrent_bytes(data):
    """Return list of (path_str, size_bytes) from raw .torrent bytes. [] on error."""
    try:
        meta, _ = _bdecode(data)
        info = meta[b'info']
        if b'files' in info:
            files = []
            for f in info[b'files']:
                path = '/'.join(p.decode('utf-8', errors='replace') for p in f[b'path'])
                files.append((path, f[b'length']))
            return files
        else:
            name = info[b'name'].decode('utf-8', errors='replace')
            return [(name, info[b'length'])]
    except Exception:
        return []


def prowlarr_search(query):
    """
    Search all Prowlarr indexers for music matching query.
    Returns list of result dicts (title, downloadUrl, size, seeders, …).
    """
    if not PROWLARR_URL or not PROWLARR_API_KEY:
        return []
    try:
        r = requests.get(
            f"{PROWLARR_URL.rstrip('/')}/api/v1/search",
            params={'query': query, 'categories': [3000], 'apikey': PROWLARR_API_KEY},
            timeout=30,
        )
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"  Prowlarr search failed: {e}")
        return []


def try_complete_from_public(folder_path, red_torrent, red_group, red_audio,
                             artist, album, year, local_files):
    """
    Search Prowlarr for a public torrent of the same album and download it in full.

    Matching criterion: the public torrent must have an audio file count within
    ±2 of the RED torrent's count.  This handles cases where different sources
    have slightly different track counts (bonus tracks, etc.) while still
    filtering out completely unrelated results.

    The full album is downloaded — not just missing tracks — so the result is
    a complete local copy that can later be re-matched against RED.

    Returns 'completing' on success, None otherwise.
    """
    if not PROWLARR_URL or not PROWLARR_API_KEY:
        print("  Prowlarr not configured — cannot search public trackers.")
        print("  Set PROWLARR_URL and PROWLARR_API_KEY in the config to enable.")
        return None

    local_count = len(local_files)
    red_count   = len(red_audio)

    query = f"{artist} {album}"
    if year:
        query += f" {year}"
    print(f"\n  Searching Prowlarr for public completion: {query!r}")
    print(f"  (local={local_count} files, RED torrent={red_count} files — downloading full album)")

    results = prowlarr_search(query)
    if not results:
        print("  No public results found.")
        return None

    # Sort by seeders descending so we try well-seeded torrents first
    results = sorted(results, key=lambda r: r.get('seeders', 0), reverse=True)
    print(f"  {len(results)} public results. Checking file lists...")

    matched_title    = None
    matched_bytes    = None
    matched_pub_root = None

    for result in results[:20]:
        title   = result.get('title', '?')
        dl_url  = result.get('downloadUrl', '')

        if not dl_url:
            print(f"    Skip (magnet only): {title[:70]}")
            continue

        try:
            resp = requests.get(dl_url, timeout=20)
            resp.raise_for_status()
            torrent_bytes = resp.content
        except Exception as e:
            print(f"    Failed to fetch {title[:60]}: {e}")
            continue

        pub_files = _parse_torrent_bytes(torrent_bytes)
        if not pub_files:
            print(f"    Could not parse torrent: {title[:70]}")
            continue

        # Count audio files in the public torrent
        pub_audio_count = sum(
            1 for f, _ in pub_files if Path(f).suffix.lower() in AUDIO_EXT
        )

        # Accept if audio file count is within ±2 of RED's count
        if pub_audio_count > 0 and abs(pub_audio_count - red_count) <= 2:
            print(f"    MATCH ({pub_audio_count} audio files, RED={red_count}): {title[:70]}")
            matched_title    = title
            matched_bytes    = torrent_bytes
            # Find torrent root folder
            all_parts = [Path(f).parts for f, _ in pub_files if f]
            if all_parts and all(len(p) > 1 for p in all_parts):
                roots = {p[0] for p in all_parts}
                if len(roots) == 1:
                    matched_pub_root = roots.pop()
            break
        else:
            print(f"    Skip ({pub_audio_count} audio files, RED={red_count}): {title[:60]}")

    if matched_bytes is None:
        print("  No matching public torrent found.")
        return None

    # Save the public .torrent
    safe_title   = re.sub(r'[<>:"/\\|?*]', '_', matched_title)[:80]
    torrent_file = Path(TORRENT_DIR) / f"pub_{safe_title}.torrent"

    pub_dl       = Path(PUBLIC_DL_DIR)
    download_dir = pub_dl / (matched_pub_root or safe_title)

    print(f"\n  Public torrent matched : {matched_title}")
    print(f"  Original local folder  : {folder_path}  ({local_count} files — left in place)")
    print(f"  Fresh download to      : {download_dir}")

    if DRY_RUN:
        print(f"  DRY RUN — would add public torrent to qBittorrent, save to {pub_dl}")
        return 'completing'

    torrent_file.parent.mkdir(parents=True, exist_ok=True)
    torrent_file.write_bytes(matched_bytes)
    pub_dl.mkdir(parents=True, exist_ok=True)

    # Inject as a fresh download — local files stay untouched in their original location
    ok = inject_torrent(torrent_file, pub_dl, skip_check=False)

    if ok:
        # Record the redownload so original and new can be tracked later
        _log_completion(
            original_folder=folder_path,
            original_count=local_count,
            red_count=red_count,
            red_group=red_group,
            public_title=matched_title,
            torrent_file=torrent_file,
            download_dir=download_dir,
        )
        print(f"  Logged to: {COMPLETION_LOG_FILE}")

    return 'completing' if ok else 'error'


def _log_completion(original_folder, original_count, red_count,
                    red_group, public_title, torrent_file, download_dir):
    """Append one entry to COMPLETION_LOG_FILE (JSON array)."""
    if not COMPLETION_LOG_FILE:
        return

    import datetime
    log_path = Path(COMPLETION_LOG_FILE)

    try:
        entries = json.loads(log_path.read_bytes().decode('utf-8')) if log_path.exists() else []
    except Exception:
        entries = []

    group_id   = red_group.get('groupId', '') if red_group else ''
    group_name = red_group.get('groupName', '') if red_group else ''
    raw_artist = (red_group or {}).get('artist', '')
    if isinstance(raw_artist, list):
        group_artist = ' & '.join(a.get('name', '') for a in raw_artist) or 'Various Artists'
    elif isinstance(raw_artist, dict):
        group_artist = raw_artist.get('name', 'Various Artists')
    else:
        group_artist = str(raw_artist)

    entries.append({
        'timestamp':         datetime.datetime.now().isoformat(timespec='seconds'),
        'original_folder':   str(original_folder),
        'original_files':    original_count,
        'red_files':         red_count,
        'red_group_id':      group_id,
        'red_group_url':     f"{RED_BASE_URL}/torrents.php?id={group_id}" if group_id else '',
        'red_artist':        group_artist,
        'red_album':         group_name,
        'public_title':      public_title,
        'torrent_file':      str(torrent_file),
        'download_dir':      str(download_dir),
        'status':            'queued',
    })

    try:
        log_path.write_bytes(json.dumps(entries, ensure_ascii=False, indent=2).encode('utf-8'))
    except Exception as e:
        print(f"  WARNING: could not write completion log: {e}")


# ─── UPLOAD CANDIDATES ───────────────────────────────────────────────────────

def _fmt_label(torrent):
    """Short format label for display: e.g. 'FLAC / Lossless / WEB'"""
    parts = [torrent.get('format', ''), torrent.get('encoding', ''), torrent.get('media', '')]
    return ' / '.join(p for p in parts if p)


def prepare_upload_candidate(folder_path, group, mismatch_torrents, local_fmt, local_files):
    """
    Save _upload_info.json in UPLOAD_DIR describing the upload candidate.

    Called when RED has a group for this release but none of the group's torrents
    match the local format — meaning the local format may be uploadable as a new
    torrent in the existing group.

    Args:
        folder_path:       Path — local album folder
        group:             dict — RED search result group
        mismatch_torrents: list of RED torrent dicts that exist in this group
        local_fmt:         str — e.g. 'MP3 320', 'FLAC', 'FLAC 24bit'
        local_files:       list of Path — local audio files
    """
    group_id   = group.get('groupId', '')
    group_name = group.get('groupName', '')
    group_year = group.get('groupYear', '')
    raw_artist = group.get('artist', '')
    if isinstance(raw_artist, list):
        group_artist = ' & '.join(a.get('name', '') for a in raw_artist) or 'Various Artists'
    elif isinstance(raw_artist, dict):
        group_artist = raw_artist.get('name', 'Various Artists')
    else:
        group_artist = str(raw_artist)

    existing_fmts = [_fmt_label(t) for t in mismatch_torrents]
    local_fmt_prefix = local_fmt.split()[0]   # 'MP3', 'FLAC', etc.

    # Check whether local format is genuinely absent from the group
    group_fmt_prefixes = {_RED_FMT_MAP.get(t.get('format', ''), t.get('format', ''))
                          for t in mismatch_torrents}
    if local_fmt_prefix in group_fmt_prefixes:
        # Our format IS already on RED in this group — not an upload candidate
        return None

    info = {
        'local_folder':     str(folder_path),
        'local_format':     local_fmt,
        'local_file_count': len(local_files),
        'group_id':         group_id,
        'group_url':        f"{RED_BASE_URL}/torrents.php?id={group_id}",
        'group_name':       group_name,
        'group_year':       group_year,
        'group_artist':     group_artist,
        'existing_formats': existing_fmts,
        'upload_format':    local_fmt_prefix,
        'announce_url':     (
            f"{RED_BASE_URL}/announce/{RED_PASSKEY}"
            if RED_PASSKEY else '*** set RED_PASSKEY in config ***'
        ),
        'instructions': [
            f"1. Verify local files are a valid {local_fmt} release of this album.",
            f"2. Create a torrent pointing to the folder inside {UPLOAD_DIR}",
            f"   Announce URL: {RED_BASE_URL}/announce/{{YOUR_PASSKEY}}",
            f"   Private: yes",
            f"3. Upload to group: {RED_BASE_URL}/torrents.php?id={group_id}",
            f"   Format: {local_fmt_prefix}",
            f"   Existing formats in group: {', '.join(existing_fmts)}",
        ],
    }

    print(f"\n  UPLOAD CANDIDATE detected:")
    print(f"    Group   : {group_artist} - {group_name} ({group_year})")
    print(f"    RED URL : {RED_BASE_URL}/torrents.php?id={group_id}")
    print(f"    RED has : {', '.join(existing_fmts)}")
    print(f"    You have: {local_fmt}  ({len(local_files)} files)")

    return info   # caller handles validation + staging


# ─── UPLOAD VALIDATION & STAGING ─────────────────────────────────────────────

import subprocess as _sp

def _ffmpeg_available():
    try:
        _sp.run(['ffmpeg', '-version'], capture_output=True, check=True, timeout=5)
        return True
    except Exception:
        return False


def _spectral_check(audio_file, test_hz=16000, threshold_db=-50.0):
    """
    Apply a high-pass filter at test_hz via ffmpeg and measure the remaining volume.
    If max volume above test_hz is below threshold_db, the file likely has no
    high-frequency content — typical of a lossy transcode.

    Returns (ok: bool, description: str).
    """
    try:
        result = _sp.run(
            ['ffmpeg', '-v', 'quiet', '-i', str(audio_file),
             '-af', f'highpass=f={test_hz},volumedetect',
             '-t', '90', '-f', 'null', '-'],
            capture_output=True, text=True, timeout=120,
        )
        m = re.search(r'max_volume:\s*(-?[\d.]+)\s*dB', result.stderr)
        if m:
            max_vol = float(m.group(1))
            if max_vol < threshold_db:
                return False, (
                    f"max volume above {test_hz} Hz is {max_vol:.1f} dB "
                    f"(threshold {threshold_db} dB) — possible transcode"
                )
        return True, ''
    except Exception as e:
        return True, f"spectral check error (skipped): {e}"


def validate_upload_candidate(folder_path, local_fmt, local_files):
    """
    Run format consistency and spectral checks on the upload candidate.

    Checks:
      1. Every file's actual bitrate matches the claimed format.
      2. Bitrates are consistent across the folder (no mixed-bitrate folder).
      3. Spectral integrity — high-frequency content present, indicating a
         proper encode rather than a lossy-to-lossy transcode.

    Returns (passed: bool, issues: list[str], warnings: list[str]).
    issues   = hard failures (block upload staging)
    warnings = soft notes (don't block, just inform)
    """
    issues   = []
    warnings = []

    # ── 1. Bitrate consistency ────────────────────────────────────────────
    actual_fmts = {}
    for f in local_files:
        af = get_fmt(f)
        actual_fmts[f.name] = af
        if af != local_fmt:
            issues.append(f"Bitrate mismatch: {f.name} is actually {af} (expected {local_fmt})")

    unique_fmts = set(actual_fmts.values())
    if len(unique_fmts) > 1:
        issues.append(f"Mixed bitrates in folder: {', '.join(sorted(unique_fmts))}")

    # ── 2. Spectral check via ffmpeg ─────────────────────────────────────
    fmt_prefix = local_fmt.split()[0]   # 'MP3', 'FLAC', …

    # Cutoff to test and minimum acceptable volume above it
    spectral_params = {
        'MP3': (16000, -50.0),    # proper MP3 should have content above 16kHz
        'FLAC': (19000, -60.0),   # FLAC from CD should reach 19kHz+
    }
    params = spectral_params.get(fmt_prefix)

    if params:
        if not _ffmpeg_available():
            warnings.append("ffmpeg not found — spectral check skipped (install ffmpeg)")
        else:
            check_files = local_files[:3]   # check first 3 tracks
            print(f"  Running spectral check on {len(check_files)} file(s)...")
            for f in check_files:
                ok, desc = _spectral_check(f, *params)
                if not ok:
                    issues.append(f"Spectral fail: {f.name}: {desc}")
                else:
                    print(f"    OK  {f.name}")

    passed = len(issues) == 0
    return passed, issues, warnings


def stage_upload_candidate(folder_path, info, issues, warnings, passed):
    """
    If validation passed: move folder to UPLOAD_DIR, write _upload_info.json inside.
    If failed: write JSON to UPLOAD_DIR/_INVALID/ and leave files in place.
    Returns 'upload_candidate' or 'upload_invalid'.
    """
    info = dict(info)
    info['validation_passed'] = passed
    info['validation_issues'] = issues
    info['validation_warnings'] = warnings

    if not passed:
        invalid_dir = Path(UPLOAD_DIR) / '_INVALID'
        invalid_dir.mkdir(parents=True, exist_ok=True)
        safe = re.sub(r'[<>:"/\\|?*]', '_', folder_path.name)
        out  = invalid_dir / f"{safe}._upload_info.json"
        out.write_bytes(json.dumps(info, ensure_ascii=False, indent=2).encode('utf-8'))
        print(f"  Validation FAILED — files left in place.")
        print(f"  Info saved: {out}")
        return 'upload_invalid'

    if DRY_RUN:
        print(f"  DRY RUN — would move folder to {UPLOAD_DIR}")
        return 'upload_candidate'

    # Move folder into UPLOAD_DIR
    upload_dir = Path(UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest = upload_dir / folder_path.name

    if dest.exists():
        print(f"  WARN: {dest} already exists — not moving")
    else:
        shutil.move(str(folder_path), str(dest))
        print(f"  Moved to: {dest}")

    # Write _upload_info.json inside the staged folder
    info['local_folder'] = str(dest)
    (dest / '_upload_info.json').write_bytes(
        json.dumps(info, ensure_ascii=False, indent=2).encode('utf-8')
    )
    print(f"  Written: _upload_info.json")
    return 'upload_candidate'


# ─── PROCESS ONE FOLDER ──────────────────────────────────────────────────────

def process_folder(folder_path, api, cache):
    folder_path = Path(folder_path)
    print(f"\nProcessing: {folder_path.name}")

    # Collect local audio files
    local_files = sorted(
        [p for p in folder_path.iterdir()
         if p.is_file() and p.suffix.lower() in AUDIO_EXT]
    )
    if not local_files:
        print("  No audio files found — skipping.")
        return 'skip'

    # Cache key = folder name; invalidate if any local audio file has changed
    cache_key  = folder_path.name
    mtime_sum  = sum(p.stat().st_mtime for p in local_files)
    cached     = cache.get(cache_key, {})
    cache_hit  = abs(cached.get('_mtime_sum', -1) - mtime_sum) < 0.01

    # ── Check persistent status from previous run ──────────────────────────
    prev_status = cached.get('_status') if cache_hit else None

    if prev_status == 'matched':
        tf = cached.get('_torrent_file', '')
        print(f"  Already matched & injected (torrent: {Path(tf).name if tf else '?'}) — skipping.")
        return 'matched'

    if prev_status == 'completing':
        dl_dir = cached.get('_download_dir', '')
        print(f"  Public download queued — waiting for completion in: {dl_dir or PUBLIC_DL_DIR}")
        return 'completing'

    if prev_status == 'pending_download':
        # Files were renamed and folder matched last run, but torrent download failed.
        # Retry the download now without re-doing the RED search/matching.
        tid          = cached.get('_torrent_id')
        save_path    = cached.get('_qbt_save_path', '')
        torrent_file = Path(cached.get('_torrent_file', '')) if cached.get('_torrent_file') else None
        if tid and torrent_file:
            print(f"  Retrying failed torrent download (#{tid})...")
            try:
                torrent_file.parent.mkdir(parents=True, exist_ok=True)
                api.download_torrent(tid, torrent_file)
                print(f"  Downloaded: {torrent_file.name}")
                ok = inject_torrent(torrent_file, Path(save_path) if save_path else folder_path.parent)
                if ok:
                    cached['_status'] = 'matched'
                    _save_match_cache(cache)
                    return 'matched'
            except Exception as e:
                print(f"  Retry failed: {e}")
            return 'error'

    if cache_hit:
        print("  Using cached RED results (set MATCH_CACHE_FILE='' to disable).")
    cached_torrent_details = cached.get('torrent_details', {})

    # Detect local format for pre-filtering RED candidates
    local_fmt = get_fmt(local_files[0])          # e.g. 'MP3 320', 'FLAC', 'FLAC 24bit'
    local_fmt_prefix = local_fmt.split()[0]       # 'MP3', 'FLAC', etc.
    print(f"  Local format: {local_fmt}")

    # Determine search terms: try tags first, fall back to folder name
    artist, album, year = read_folder_tags(folder_path)
    if not (artist and album):
        artist_fb, album_fb, year_fb = parse_folder_name(folder_path.name)
        artist = artist or artist_fb
        album  = album  or album_fb
        year   = year   or year_fb

    print(f"  Searching RED: artist={artist!r}  album={album!r}  year={year!r}")

    if cache_hit:
        results = cached['search_results']
    else:
        try:
            results = api.search(artist=artist, album=album)
        except Exception as e:
            print(f"  RED search failed: {e}")
            return
        # Persist after every search so a crash mid-run doesn't lose all progress
        cache[cache_key] = {
            '_mtime_sum':      mtime_sum,
            'search_results':  results,
            'torrent_details': cached_torrent_details,
        }
        _save_match_cache(cache)

    if not results:
        print("  No results on RED.")
        return 'not_found'

    # Gather all torrents from all result groups
    candidates = []
    for group in results:
        for t in group.get('torrents', []):
            candidates.append((group, t))

    print(f"  Found {len(candidates)} torrent candidates on RED.")

    best_match = None
    best_problems = None
    best_torrent = None
    best_group = None
    # Track torrents from groups that exist but have a different format than our local files.
    # Key: group_id → (group, list_of_mismatched_torrent_dicts)
    format_mismatch_groups = defaultdict(lambda: (None, []))
    # Track the best "close miss": same format, same release, but local has fewer files.
    # (torrent_detail, group, red_audio_list)
    close_miss = None

    for group, torrent in candidates:
        tid = torrent['torrentId']
        fmt = torrent.get('format', '')
        enc = torrent.get('encoding', '')
        media = torrent.get('media', '')

        # Check format compatibility
        red_fmt_prefix = _RED_FMT_MAP.get(fmt, fmt)
        if red_fmt_prefix and local_fmt_prefix and red_fmt_prefix != local_fmt_prefix:
            print(f"  Format mismatch: torrent {tid} is {fmt} (local is {local_fmt_prefix})")
            gid = group.get('groupId', id(group))
            _, existing = format_mismatch_groups[gid]
            format_mismatch_groups[gid] = (group, existing + [torrent])
            continue

        tid_str = str(tid)
        if tid_str in cached_torrent_details:
            print(f"  Checking torrent {tid}: {fmt} {enc} {media} ... (cached)")
            torrent_detail = cached_torrent_details[tid_str]
        else:
            print(f"  Checking torrent {tid}: {fmt} {enc} {media} ...")
            try:
                tdata = api.get_torrent(tid)
            except Exception as e:
                print(f"    Error fetching torrent {tid}: {e}")
                continue
            torrent_detail = tdata.get('torrent', {})
            cached_torrent_details[tid_str] = torrent_detail
            cache[cache_key] = {
                '_mtime_sum':      mtime_sum,
                'search_results':  results,
                'torrent_details': cached_torrent_details,
            }
            _save_match_cache(cache)
        filelist_raw = torrent_detail.get('fileList', '')
        all_red_files = parse_red_filelist(filelist_raw)

        # Filter to audio files only
        red_audio = [(f, s) for f, s in all_red_files
                     if Path(f).suffix.lower() in AUDIO_EXT]

        if not red_audio:
            print(f"    No audio files in torrent — skipping.")
            continue

        matches, problems = match_files(local_files, red_audio)

        # File-count-short: local has fewer files than the RED torrent.
        # Treat separately — never accept as a match, route to public completion.
        _count_short = (
            len(problems) == 1
            and 'File count mismatch' in problems[0]
            and len(local_files) < len(red_audio)
        )

        if not problems and len(matches) == len(local_files):
            print(f"    FULL MATCH ({len(matches)} files)")
            if best_match is None:
                best_match    = matches
                best_problems = problems
                best_torrent  = torrent_detail
                best_group    = group
        elif _count_short:
            print(f"    File count short: local={len(local_files)}, RED={len(red_audio)} — tracking for public completion")
            if close_miss is None:
                close_miss = (torrent_detail, group, red_audio)
        elif len(matches) > 0 and len(problems) <= max(1, len(local_files) // 5):
            print(f"    Partial match: {len(matches)} matched, {len(problems)} unmatched")
            # Keep as fallback if no perfect match found yet
            if best_match is None or len(problems) < len(best_problems or []):
                best_match    = matches
                best_problems = problems
                best_torrent  = torrent_detail
                best_group    = group
        else:
            print(f"    Poor match: {len(problems)} unmatched — skipping")

    if not best_match:
        # If local has fewer files than a RED torrent, try to complete from public trackers
        if close_miss is not None:
            td, grp, red_audio_cm = close_miss
            result = try_complete_from_public(
                folder_path, td, grp, red_audio_cm,
                artist, album, year, local_files,
            )
            if result:
                if result == 'completing':
                    cache[cache_key]['_status']       = 'completing'
                    cache[cache_key]['_download_dir'] = str(
                        Path(PUBLIC_DL_DIR) / (td.get('filePath', '') or folder_path.name)
                    )
                    _save_match_cache(cache)
                return result

        # Check whether any of the format-mismatched groups is an upload candidate.
        # Fetch the FULL group (search results only return a subset of torrents)
        # so we don't flag a format as missing when RED already has it.
        if format_mismatch_groups:
            upload_results = []
            for gid, (group, mismatch_torrents) in format_mismatch_groups.items():
                all_torrents = mismatch_torrents   # fallback if fetch fails
                try:
                    print(f"  Fetching full group {gid} to verify missing formats...")
                    full = api.get_group(gid)
                    all_torrents = full.get('torrents', mismatch_torrents)
                    present_fmts = ', '.join(
                        f"{t.get('format')} {t.get('encoding')}" for t in all_torrents
                    )
                    print(f"  Group has {len(all_torrents)} torrent(s): {present_fmts}")
                except Exception as e:
                    print(f"  Could not fetch full group {gid}: {e} — using search results only")
                info = prepare_upload_candidate(
                    folder_path, group, all_torrents, local_fmt, local_files
                )
                if info:
                    passed, issues, warnings = validate_upload_candidate(
                        folder_path, local_fmt, local_files
                    )
                    result = stage_upload_candidate(
                        folder_path, info, issues, warnings, passed
                    )
                    upload_results.append(result)
            if upload_results:
                # Return the worst outcome: upload_invalid beats upload_candidate
                if any(r == 'upload_invalid' for r in upload_results):
                    return 'upload_invalid'
                return 'upload_candidate'
        print("  No usable match found.")
        return 'not_found'

    # Determine torrent root folder name
    # RED stores files as "RootFolder/01 - track.mp3" or just "01 - track.mp3"
    all_red_files_full = parse_red_filelist(best_torrent.get('fileList', ''))
    # Find common prefix (the root folder name in torrent)
    torrent_root = None
    first_parts = [Path(f).parts for f, _ in all_red_files_full if f]
    if first_parts and all(len(p) > 1 for p in first_parts):
        roots = {p[0] for p in first_parts}
        if len(roots) == 1:
            torrent_root = roots.pop()

    # Build display info string
    group_name   = best_group.get('groupName', '')
    group_year   = best_group.get('groupYear', '')
    raw_artist   = best_group.get('artist', '')
    # artist can be a plain string or a list of dicts [{'id':..,'name':..}]
    if isinstance(raw_artist, list):
        group_artist = ' & '.join(a.get('name', '') for a in raw_artist) or 'Various Artists'
    elif isinstance(raw_artist, dict):
        group_artist = raw_artist.get('name', 'Various Artists')
    else:
        group_artist = str(raw_artist)
    torrent_info = (
        f"{group_artist} - {group_name} ({group_year}) | "
        f"torrent #{best_torrent.get('id', '?')} | "
        f"{best_torrent.get('format','')} {best_torrent.get('encoding','')}"
    )

    print_rename_table(best_match, folder_path, torrent_root, torrent_info)

    if best_problems:
        print("\n  UNMATCHED FILES:")
        for p in best_problems:
            print(f"    - {p}")

    if DRY_RUN:
        print("\n  DRY RUN — no changes made. Set DRY_RUN = False to execute.")
        return 'dry_run'

    # ── Rename files ────────────────────────────────────────────────────────
    for m in best_match:
        local_file = m['local']
        red_basename = Path(m['red_name']).name   # strip any root-folder prefix
        target = local_file.parent / red_basename
        if local_file == target:
            continue
        if target.exists():
            print(f"  SKIP (exists): {red_basename}")
            continue
        local_file.rename(target)
        print(f"  Renamed: {local_file.name}  →  {red_basename}")

    # ── Rename / move folder ────────────────────────────────────────────────
    dest = Path(DEST_DIR)
    dest.mkdir(parents=True, exist_ok=True)

    final_folder_name = torrent_root or folder_path.name
    target_folder = dest / final_folder_name

    if target_folder == folder_path:
        print(f"  Folder name already correct.")
    elif target_folder.exists():
        print(f"  WARN: target folder already exists, skipping rename: {final_folder_name}")
    else:
        shutil.move(str(folder_path), str(target_folder))
        print(f"  Folder renamed: {folder_path.name}  →  {final_folder_name}")
    folder_path = target_folder

    # ── Download .torrent ───────────────────────────────────────────────────
    torrent_save_dir = Path(TORRENT_DIR)
    torrent_save_dir.mkdir(parents=True, exist_ok=True)
    tid          = best_torrent['id']
    torrent_file = torrent_save_dir / f"red_{tid}.torrent"

    # qBittorrent save_path: parent when torrent has a root folder (it will create
    # the subfolder itself); the folder itself when torrent is flat (no root).
    qbt_save_path = folder_path.parent if torrent_root else folder_path

    try:
        api.download_torrent(tid, torrent_file)
        print(f"  Downloaded: {torrent_file.name}")
    except Exception as e:
        print(f"  ERROR downloading torrent: {e}")
        dl_link = f"{RED_BASE_URL}/torrents.php?action=download&id={tid}"
        stub    = torrent_file.with_suffix('.download_manually.txt')
        stub.write_text(
            f"Torrent download failed: {e}\n\n"
            f"Download URL : {dl_link}\n"
            f"Save .torrent to : {torrent_file}\n"
            f"qBittorrent save path : {qbt_save_path}\n"
            f"(Add torrent manually, set save path as above)\n",
            encoding='utf-8',
        )
        print(f"  Saved manual-download info: {stub.name}")
        # Remember state so next run retries the download automatically
        cache[cache_key]['_status']        = 'pending_download'
        cache[cache_key]['_torrent_id']    = tid
        cache[cache_key]['_torrent_file']  = str(torrent_file)
        cache[cache_key]['_qbt_save_path'] = str(qbt_save_path)
        _save_match_cache(cache)
        return 'pending_download'

    # ── Inject into qBittorrent ─────────────────────────────────────────────
    ok = inject_torrent(torrent_file, qbt_save_path)
    if ok:
        cache[cache_key]['_status']       = 'matched'
        cache[cache_key]['_torrent_file'] = str(torrent_file)
        _save_match_cache(cache)
    return 'matched' if ok else 'error'


# ─── STARTUP CHECK ───────────────────────────────────────────────────────────

def _check_access(api):
    """
    Verify API key and download permission before processing any folders.
    Returns True if all good, False if a fatal problem is found.
    """
    print("Checking RED API access...")

    # 1. Basic API key check via index action
    try:
        index    = api._get('/ajax.php', {'action': 'index'})
        username = index.get('username', '?')
        print(f"  API key    : OK  (user: {username})")
    except Exception as e:
        print(f"  API key    : FAILED — {e}")
        print("  Check RED_API_KEY in the config.")
        return False

    # 2. Download permission check.
    # Use a known-valid torrent ID from the user's own snatches via the index response,
    # falling back to id=1000 (well-known old torrent). We don't save the file — just
    # check that the response is a binary torrent, not an HTML error page.
    def _try_download(extra_params=None):
        elapsed = time.time() - api._last_req
        if elapsed < 2.1:
            time.sleep(2.1 - elapsed)
        params = {'action': 'download', 'id': 1000, **(extra_params or {})}
        resp = api.session.get(
            f"{api.base_url}/torrents.php", params=params, timeout=15,
        )
        api._last_req = time.time()
        ct = resp.headers.get('content-type', '')
        # Success = binary torrent data OR any non-401 non-HTML response
        # (404 = auth OK but torrent gone, still means download permission works)
        ok = resp.status_code != 401 and 'text/html' not in ct
        return ok, resp.status_code, ct

    ok, code, ct = _try_download()
    if not ok:
        # Try with auth key in query string (RED supports ?auth=KEY as alternative)
        ok, code, ct = _try_download({'auth': RED_API_KEY})
    if not ok and RED_PASSKEY:
        ok, code, ct = _try_download({'torrent_pass': RED_PASSKEY})

    if ok:
        print(f"  Download   : OK  (status {code})")
    else:
        print(f"  Download   : WARNING — status {code}, content-type: {ct}")
        print("               Downloads may fail. Check 'Torrents' permission on your API key.")
        print("               Continuing anyway — will retry per-torrent with all auth methods.")

    print()
    return True


# ─── MAIN ────────────────────────────────────────────────────────────────────

def main():
    if not RED_API_KEY:
        print("ERROR: RED_API_KEY is not set. Edit the CONFIG section at the top.")
        sys.exit(1)

    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(LOCAL_FOLDER)
    if not root.exists():
        print(f"ERROR: Path not found: {root}")
        sys.exit(1)

    api   = RedAPI(RED_API_KEY, RED_BASE_URL)

    if not _check_access(api):
        sys.exit(1)

    cache = _load_match_cache()

    # Single album folder (has audio at root) or batch directory of album folders
    has_audio = any(p.suffix.lower() in AUDIO_EXT
                    for p in root.iterdir() if p.is_file())
    if has_audio:
        folders = [root]
    else:
        def _should_skip(name):
            nl = name.lower()
            return any(kw.lower() in nl for kw in SKIP_FOLDERS)

        folders = sorted(
            [p for p in root.iterdir()
             if p.is_dir() and not p.name.startswith('.') and not _should_skip(p.name)],
            key=lambda p: p.name
        )

    total = len(folders)
    print(f"Found {total} folder(s) to process.  DRY_RUN={DRY_RUN}\n")

    counts = {'matched': 0, 'not_found': 0, 'dry_run': 0, 'skip': 0,
              'error': 0, 'upload_candidate': 0, 'upload_invalid': 0,
              'completing': 0, 'pending_download': 0}
    not_found_list = []
    upload_candidate_list = []
    upload_invalid_list = []
    completing_list = []
    pending_list = []

    for i, folder in enumerate(folders, 1):
        print(f"[{i}/{total}] {folder.name}")
        try:
            status = process_folder(folder, api, cache) or 'error'
        except KeyboardInterrupt:
            print("\nInterrupted.")
            break
        except Exception as e:
            print(f"  ERROR: {e}")
            status = 'error'
        counts[status] = counts.get(status, 0) + 1
        if status == 'not_found':
            not_found_list.append(folder.name)
        elif status == 'upload_candidate':
            upload_candidate_list.append(folder.name)
        elif status == 'upload_invalid':
            upload_invalid_list.append(folder.name)
        elif status == 'completing':
            completing_list.append(folder.name)
        elif status == 'pending_download':
            pending_list.append(folder.name)

    print()
    print('=' * 60)
    print(f"  SUMMARY  ({total} folders)")
    print('=' * 60)
    print(f"  Matched & injected   : {counts['matched']}")
    print(f"  Dry-run previewed    : {counts['dry_run']}")
    print(f"  Completing (public)  : {counts['completing']}")
    print(f"  Pending dl (retry)   : {counts['pending_download']}")
    print(f"  Upload candidates    : {counts['upload_candidate']}")
    print(f"  Upload invalid       : {counts['upload_invalid']}")
    print(f"  Not found on RED     : {counts['not_found']}")
    print(f"  Skipped (no audio)   : {counts['skip']}")
    print(f"  Errors               : {counts['error']}")
    if pending_list:
        print(f"\n  Pending torrent download (will auto-retry on next run):")
        for name in pending_list:
            print(f"    ! {name}  →  see {TORRENT_DIR}\\red_*.download_manually.txt")
    if completing_list:
        print(f"\n  Completing via public torrent (in {PUBLIC_DL_DIR}):")
        for name in completing_list:
            print(f"    ~ {name}")
    if upload_candidate_list:
        print(f"\n  Upload candidates (staged in {UPLOAD_DIR}):")
        for name in upload_candidate_list:
            print(f"    + {name}")
    if upload_invalid_list:
        print(f"\n  Upload invalid — failed validation (info in {UPLOAD_DIR}/_INVALID/):")
        for name in upload_invalid_list:
            print(f"    ✗ {name}")
    if not_found_list:
        print(f"\n  Not found on RED:")
        for name in not_found_list:
            print(f"    - {name}")


if __name__ == '__main__':
    main()
