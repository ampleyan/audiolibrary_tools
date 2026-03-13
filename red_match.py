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

RED_API_KEY    = ""                      # RED > Profile > Security > API Keys
RED_BASE_URL   = "https://redacted.ch"

QBT_HOST       = "http://kodisrv:8080"  # qBittorrent Web UI on kodisrv
QBT_USERNAME   = "admin"
QBT_PASSWORD   = ""

LOCAL_FOLDER   = r"Z:\MUSIC\STAGING"    # folder to process (single album or dir of albums)
TORRENT_DIR    = r"Z:\MUSIC\TORRENTS"   # where downloaded .torrent files are saved
DEST_DIR       = r"Z:\MUSIC\REDACTED"   # where matched+renamed folders are moved to

SIZE_TOLERANCE = 0.005   # 0.5% — files within this size delta are considered same
MIN_NAME_SIM   = 0.55    # minimum similarity score (0-1) for name-only fallback match
DRY_RUN        = True    # True = show plan only, False = rename + inject

# ─── END CONFIG ───────────────────────────────────────────────────────────────

import os, re, sys, time, shutil
from difflib import SequenceMatcher
from pathlib import Path
from collections import defaultdict

import requests
try:
    from rapidfuzz import fuzz as rfuzz
    USE_RAPIDFUZZ = True
except ImportError:
    USE_RAPIDFUZZ = False

from musiclib import AUDIO_EXT, get_tags, get_artist, get_album, get_year, read_metadata

# ─── RED API ─────────────────────────────────────────────────────────────────

class RedAPI:
    def __init__(self, api_key, base_url):
        self.session = requests.Session()
        self.session.headers.update({'Authorization': api_key})
        self.base_url = base_url.rstrip('/')
        self._last_req = 0.0

    def _get(self, path, params):
        # Throttle: RED allows ~10 req / 10s
        elapsed = time.time() - self._last_req
        if elapsed < 1.1:
            time.sleep(1.1 - elapsed)
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

    def download_torrent(self, torrent_id, dest_path):
        """Download .torrent file to dest_path (Path object)."""
        elapsed = time.time() - self._last_req
        if elapsed < 1.1:
            time.sleep(1.1 - elapsed)
        r = self.session.get(
            f"{self.base_url}/torrents.php",
            params={'action': 'download', 'id': torrent_id},
            timeout=30
        )
        self._last_req = time.time()
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

def inject_torrent(torrent_path, save_path):
    """Add .torrent to qBittorrent on kodisrv with skip-check."""
    try:
        import qbittorrentapi
    except ImportError:
        print("  WARNING: qbittorrent-api not installed. Skipping inject.")
        print("           Run: pip install qbittorrent-api")
        return False

    host, *port_part = QBT_HOST.replace('http://', '').split(':')
    port = int(port_part[0]) if port_part else 8080

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
                is_skip_checking=True,
                category='red-crossseed',
            )
        client.auth_log_out()
        print(f"  Injected into qBittorrent: save_path={save_path}")
        return True
    except Exception as e:
        print(f"  ERROR injecting torrent: {e}")
        return False


# ─── PROCESS ONE FOLDER ──────────────────────────────────────────────────────

def process_folder(folder_path, api):
    folder_path = Path(folder_path)
    print(f"\nProcessing: {folder_path.name}")

    # Collect local audio files
    local_files = sorted(
        [p for p in folder_path.iterdir()
         if p.is_file() and p.suffix.lower() in AUDIO_EXT]
    )
    if not local_files:
        print("  No audio files found — skipping.")
        return

    # Determine search terms: try tags first, fall back to folder name
    artist, album, year = read_folder_tags(folder_path)
    if not (artist and album):
        artist_fb, album_fb, year_fb = parse_folder_name(folder_path.name)
        artist = artist or artist_fb
        album  = album  or album_fb
        year   = year   or year_fb

    print(f"  Searching RED: artist={artist!r}  album={album!r}  year={year!r}")

    try:
        results = api.search(artist=artist, album=album)
    except Exception as e:
        print(f"  RED search failed: {e}")
        return

    if not results:
        print("  No results on RED.")
        return

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

    for group, torrent in candidates:
        tid = torrent['torrentId']
        fmt = torrent.get('format', '')
        enc = torrent.get('encoding', '')
        media = torrent.get('media', '')
        print(f"  Checking torrent {tid}: {fmt} {enc} {media} ...")

        try:
            tdata = api.get_torrent(tid)
        except Exception as e:
            print(f"    Error fetching torrent {tid}: {e}")
            continue

        torrent_detail = tdata.get('torrent', {})
        filelist_raw = torrent_detail.get('fileList', '')
        all_red_files = parse_red_filelist(filelist_raw)

        # Filter to audio files only
        red_audio = [(f, s) for f, s in all_red_files
                     if Path(f).suffix.lower() in AUDIO_EXT]

        if not red_audio:
            print(f"    No audio files in torrent — skipping.")
            continue

        matches, problems = match_files(local_files, red_audio)

        if not problems and len(matches) == len(local_files):
            print(f"    FULL MATCH ({len(matches)} files)")
            if best_match is None:
                best_match    = matches
                best_problems = problems
                best_torrent  = torrent_detail
                best_group    = group
        elif len(problems) <= max(1, len(local_files) // 5):
            print(f"    Partial match: {len(matches)} matched, {len(problems)} unmatched")
            # Keep as fallback if no perfect match found yet
            if best_match is None or len(problems) < len(best_problems or []):
                best_match    = matches
                best_problems = problems
                best_torrent  = torrent_detail
                best_group    = group
        else:
            print(f"    Poor match: {len(problems)} unmatched — skipping")

    if best_match is None:
        print("  No usable match found.")
        return

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
    group_name  = best_group.get('groupName', '')
    group_year  = best_group.get('groupYear', '')
    group_artist = best_group.get('artist', '')
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
        return

    # ── Confirm ────────────────────────────────────────────────────────────
    answer = input("\n  Apply renames and inject torrent? [y/N]: ").strip().lower()
    if answer != 'y':
        print("  Aborted.")
        return

    # ── Rename files ────────────────────────────────────────────────────────
    for m in best_match:
        local_file = m['local']
        # RED filelist may include a root folder prefix — strip it
        red_basename = Path(m['red_name']).name
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

    if target_folder.exists():
        print(f"  WARN: target folder already exists: {target_folder}")
    else:
        shutil.move(str(folder_path), str(target_folder))
        print(f"  Moved folder to: {target_folder}")
    folder_path = target_folder

    # ── Download .torrent ───────────────────────────────────────────────────
    torrent_save_dir = Path(TORRENT_DIR)
    torrent_save_dir.mkdir(parents=True, exist_ok=True)
    torrent_file = torrent_save_dir / f"red_{best_torrent['id']}.torrent"

    try:
        api.download_torrent(best_torrent['id'], torrent_file)
        print(f"  Downloaded: {torrent_file.name}")
    except Exception as e:
        print(f"  ERROR downloading torrent: {e}")
        return

    # ── Inject into qBittorrent ─────────────────────────────────────────────
    # save_path is the PARENT of the album folder (torrent contains the root folder)
    inject_torrent(torrent_file, folder_path.parent)


# ─── MAIN ────────────────────────────────────────────────────────────────────

def main():
    if not RED_API_KEY:
        print("ERROR: RED_API_KEY is not set. Edit the CONFIG section at the top.")
        sys.exit(1)

    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(LOCAL_FOLDER)
    if not root.exists():
        print(f"ERROR: Path not found: {root}")
        sys.exit(1)

    api = RedAPI(RED_API_KEY, RED_BASE_URL)

    # If root is a single album folder (contains audio files), process it directly.
    # If root is a staging dir of album folders, walk one level.
    has_audio = any(p.suffix.lower() in AUDIO_EXT
                    for p in root.iterdir() if p.is_file())
    if has_audio:
        folders = [root]
    else:
        folders = sorted(
            [p for p in root.iterdir()
             if p.is_dir() and not p.name.startswith('.')],
            key=lambda p: p.name
        )

    print(f"Found {len(folders)} folder(s) to process.")
    for folder in folders:
        try:
            process_folder(folder, api)
        except KeyboardInterrupt:
            print("\nInterrupted.")
            break
        except Exception as e:
            print(f"  ERROR processing {folder.name}: {e}")
            continue


if __name__ == '__main__':
    main()
