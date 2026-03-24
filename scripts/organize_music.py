"""
organize_music.py
-----------------
Scans a source folder, reads audio metadata, and reorganizes files into:
    Artist - Album (Year) - Format Bitrate

Usage:
    python scripts/organize_music.py

Configuration: edit config.py at the project root.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import os, re, shutil, json
from collections import defaultdict

import config
from lib.musiclib import (
    AUDIO_EXT, JUNK_ALBUM_TAGS,
    read_metadata, build_folder_name,
)

# Force UTF-8 on stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

_IS_TTY = sys.stdout.isatty()


class _Tee:
    """Write to both the original stdout and a UTF-8 log file."""
    def __init__(self, stream, log_path):
        self._stream  = stream
        self._logfile = open(log_path, 'w', encoding='utf-8')

    def write(self, data):
        self._stream.write(data)
        self._logfile.write(data)

    def flush(self):
        self._stream.flush()
        self._logfile.flush()

    def close(self):
        self._logfile.close()

    def __getattr__(self, name):
        return getattr(self._stream, name)


if config.LOG_FILE:
    sys.stdout = _Tee(sys.stdout, config.LOG_FILE)


def _load_cache():
    if not config.CACHE_FILE:
        return {}
    cache_path = Path(config.CACHE_FILE)
    if not cache_path.exists():
        return {}
    try:
        raw = json.loads(cache_path.read_bytes().decode('utf-8'))
        valid, stale = {}, 0
        for path_str, entry in raw.items():
            p = Path(path_str)
            if not p.exists() or p.stat().st_mtime != entry.get('_mtime'):
                stale += 1
                continue
            valid[p] = {k: v for k, v in entry.items() if not k.startswith('_')}
        if stale:
            print(f"  Cache: {len(valid)} valid, {stale} stale/missing entries skipped.")
        else:
            print(f"  Cache: {len(valid)} entries loaded.")
        return valid
    except Exception as e:
        print(f"  Cache load failed ({e}), will rescan.")
        return {}


def _save_cache(file_meta):
    if not config.CACHE_FILE:
        return
    try:
        raw = {}
        for path, meta in file_meta.items():
            entry = dict(meta)
            entry['_mtime'] = path.stat().st_mtime
            raw[str(path)] = entry
        Path(config.CACHE_FILE).write_bytes(
            json.dumps(raw, ensure_ascii=False, indent=2).encode('utf-8')
        )
        print(f"  Cache saved: {config.CACHE_FILE}")
    except Exception as e:
        print(f"  Cache save failed: {e}")


def _progress(current, total, label=''):
    pct = int(100 * current / total) if total else 100
    bar = f'[{pct:3d}%] {current}/{total}'
    if label:
        max_len = 78 - len(bar) - 2
        if len(label) > max_len:
            label = '…' + label[-(max_len - 1):]
        bar = f'{bar}  {label}'
    if _IS_TTY:
        print(f'\r{bar:<78}', end='', flush=True)
        if current >= total:
            print()
    else:
        milestone = max(1, total // 20)
        if current == 1 or current % milestone == 0 or current >= total:
            print(bar, flush=True)


def collect_files(root):
    root = Path(root)
    for dirpath, dirnames, filenames in os.walk(root):
        dirpath = Path(dirpath)
        dirnames[:] = [d for d in dirnames
                       if d not in config.SKIP_FOLDERS and not d.startswith('.')]
        for fname in filenames:
            if Path(fname).suffix.lower() in AUDIO_EXT:
                yield dirpath / fname


def process():
    src  = Path(config.MUSIC_PROCESS_DIR)
    dest = Path(config.MUSIC_LIBRARY_DIR)

    if not src.exists():
        print(f"ERROR: Source folder not found: {src}")
        sys.exit(1)

    print(f"Scanning: {src}")
    print(f"Destination: {dest}")
    print(f"Dry run: {config.DRY_RUN}")
    print()

    all_files  = list(collect_files(src))
    print(f"Found {len(all_files)} audio files.")

    cache       = _load_cache()
    cached_hits = sum(1 for p in all_files if p in cache)
    to_scan     = [p for p in all_files if p not in cache]

    if cached_hits:
        print(f"  {cached_hits} from cache, {len(to_scan)} need scanning.")
    if to_scan:
        print(f"Reading metadata for {len(to_scan)} files...")

    file_meta = dict(cache)
    for i, path in enumerate(to_scan, 1):
        _progress(i, len(to_scan), path.name)
        file_meta[path] = read_metadata(path)

    if to_scan:
        print()
        _save_cache(file_meta)
    print()

    groups    = defaultdict(list)
    ungrouped = []

    for path, meta in file_meta.items():
        album  = meta['album']
        artist = meta['artist']

        if album.lower() in JUNK_ALBUM_TAGS or re.match(r'https?://|www\.', album.lower()):
            album = ''
        if artist.lower() in JUNK_ALBUM_TAGS or re.match(r'https?://|www\.', artist.lower()):
            artist = ''

        if not album and path.parent != src:
            album  = path.parent.name
            artist = artist or 'Various Artists'

        if album:
            groups[(artist or 'Unknown Artist', album, meta['year'])].append(path)
        else:
            ungrouped.append(path)

    moves   = []
    skipped = []

    print(f"Album groups found: {len(groups)}")
    print(f"Files without album tag: {len(ungrouped)}\n")

    for (artist, album, year), paths in sorted(groups.items()):
        if len(paths) < config.MIN_TRACKS_FOR_FOLDER:
            skipped.extend(paths)
            continue
        fmt = next((file_meta[p]['fmt'] for p in paths if file_meta[p]['fmt']), 'Unknown')
        folder_name = build_folder_name(artist, album, year, fmt)
        target_dir  = dest / folder_name
        for path in paths:
            moves.append((path, target_dir / path.name))

    solo_by_artist = defaultdict(list)
    truly_unknown  = []
    for path in ungrouped:
        meta   = file_meta[path]
        artist = meta['artist']
        if artist.lower() in JUNK_ALBUM_TAGS or re.match(r'https?://|www\.', artist.lower()):
            artist = ''
        if not artist:
            m = re.match(r'^(.+?)\s+-\s+.+$', path.stem)
            artist = m.group(1).strip() if m else ''
        if artist:
            solo_by_artist[artist].append(path)
        else:
            truly_unknown.append(path)

    for artist, paths in sorted(solo_by_artist.items()):
        if len(paths) >= 2:
            folder_name = build_folder_name(artist, 'Singles', 'Various', 'MP3')
            target_dir  = dest / folder_name
            for path in paths:
                moves.append((path, target_dir / path.name))
        else:
            skipped.extend(paths)
    skipped.extend(truly_unknown)

    print("=" * 72)
    print(f"PLAN: {len(moves)} files to move into "
          f"{len(set(str(d.parent) for _, d in moves))} folders")
    print(f"      {len(skipped)} files will be left in place\n")

    by_dest = defaultdict(list)
    for src_path, dst_path in moves:
        by_dest[dst_path.parent].append((src_path, dst_path))

    for folder in sorted(by_dest):
        file_list = by_dest[folder]
        print(f"  📁 {folder.name}  ({len(file_list)} files)")
        for src_path, _ in sorted(file_list, key=lambda x: x[0].name):
            arrow = "  (no move needed)" if src_path.parent == folder else ""
            print(f"      {src_path.name}{arrow}")
        print()

    if skipped:
        print(f"  ── Left in place ({len(skipped)}) ──")
        for p in sorted(skipped):
            print(f"    {p.relative_to(src)}")
        print()

    if config.DRY_RUN:
        print("DRY RUN complete. Set DRY_RUN = False in config.py to execute.")
        return

    print(f"Executing moves ({len(moves)} files)...")
    errors, moved = [], 0
    for i, (src_path, dst_path) in enumerate(moves, 1):
        _progress(i, len(moves), src_path.name)
        try:
            dst_path.parent.mkdir(parents=True, exist_ok=True)
            if src_path != dst_path:
                shutil.move(str(src_path), str(dst_path))
                moved += 1
        except Exception as e:
            errors.append((src_path, dst_path, str(e)))
            print(f"\n  ERROR: {src_path.name} → {e}")

    for dirpath, dirnames, filenames in os.walk(src, topdown=False):
        dirpath = Path(dirpath)
        if dirpath == src:
            continue
        try:
            if not [f for f in dirpath.iterdir() if not f.name.startswith('.')]:
                dirpath.rmdir()
                print(f"  Removed empty dir: {dirpath.relative_to(src)}")
        except Exception:
            pass

    print(f"\nDone. Moved {moved} files.")
    if errors:
        print(f"Errors: {len(errors)}")
        for s, d, e in errors:
            print(f"  {s.name}: {e}")


if __name__ == '__main__':
    process()
