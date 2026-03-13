"""
Music Folder Organizer
======================
Scans a source folder, reads audio metadata, and reorganizes files into:
    Artist - Album (Year) - Format Bitrate

Usage:
    python organize_music.py

Requirements:
    pip install mutagen

Configuration (edit the section below):
"""

# ─── CONFIGURATION ────────────────────────────────────────────────────────────

SOURCE_DIR  = r"D:\MUSIC\TO PROCESS"   # Folder to scan
DEST_DIR    = r"Z:\MUSIC\TO PROCESS"   # Where to move organised folders
                                        # Set to SOURCE_DIR to reorganise in-place
DRY_RUN     = True   # Set to False to actually move files (True = preview only)

# Folders inside SOURCE_DIR to completely skip (utility/work folders)
SKIP_FOLDERS = {
    "complete", "downloading", "new", "onlyraretracks",
    "FAKES", "FOLDERS TO CHECK", "IN PROGRESS", "REV",
    "Sort 2 Single Trax", "New folder (2)", "MUSIC",
}

# Minimum number of tracks in one album group before creating a folder.
# Single-track "albums" are left loose unless they have a proper album tag.
MIN_TRACKS_FOR_FOLDER = 2

# ─── END CONFIGURATION ────────────────────────────────────────────────────────

import os, re, shutil, sys
from collections import defaultdict
from pathlib import Path

from musiclib import (
    AUDIO_EXT, JUNK_ALBUM_TAGS,
    safe_name, read_metadata, build_folder_name,
)


def collect_files(root):
    """Yield (path, relative_depth) for all audio files under root."""
    root = Path(root)
    for dirpath, dirnames, filenames in os.walk(root):
        dirpath = Path(dirpath)
        # Skip utility folders at any depth
        dirnames[:] = [d for d in dirnames if d not in SKIP_FOLDERS
                       and not d.startswith('.')]
        for fname in filenames:
            if Path(fname).suffix.lower() in AUDIO_EXT:
                yield dirpath / fname


def process():
    src  = Path(SOURCE_DIR)
    dest = Path(DEST_DIR)

    if not src.exists():
        print(f"ERROR: Source folder not found: {src}")
        sys.exit(1)

    print(f"Scanning: {src}")
    print(f"Destination: {dest}")
    print(f"Dry run: {DRY_RUN}")
    print()

    # ── 1. Gather all audio files and their metadata ──────────────────────────
    all_files = list(collect_files(src))
    print(f"Found {len(all_files)} audio files. Reading metadata...")

    file_meta = {}
    for i, path in enumerate(all_files):
        if i % 50 == 0 and i > 0:
            print(f"  {i}/{len(all_files)}...")
        file_meta[path] = read_metadata(path)

    print(f"  Done.\n")

    # ── 2. Group by (artist, album) ───────────────────────────────────────────
    # Key: (artist, album_clean, year) → list of paths
    groups = defaultdict(list)
    ungrouped = []  # files with no usable album tag

    for path, meta in file_meta.items():
        album  = meta['album']
        artist = meta['artist']

        # Strip junk album tags from download sites
        if album.lower() in JUNK_ALBUM_TAGS:
            album = ''
        # Also strip URLs-as-album-names
        if re.match(r'https?://', album) or re.match(r'www\.', album):
            album = ''

        if album:
            key = (artist or 'Unknown Artist', album, meta['year'])
            groups[key].append(path)
        else:
            ungrouped.append(path)

    # ── 3. Decide what to do with each group ─────────────────────────────────
    moves = []      # list of (src_path, dest_path)
    skipped = []    # files left in place

    print(f"Album groups found: {len(groups)}")
    print(f"Files without album tag: {len(ungrouped)}\n")

    for (artist, album, year), paths in sorted(groups.items()):
        if len(paths) < MIN_TRACKS_FOR_FOLDER and not year:
            # Single-track, no year → leave loose
            skipped.extend(paths)
            continue

        # Get format from first file that has one
        fmt = next((file_meta[p]['fmt'] for p in paths if file_meta[p]['fmt']), 'Unknown')
        folder_name = build_folder_name(artist, album, year, fmt)
        target_dir  = dest / folder_name

        for path in paths:
            dest_path = target_dir / path.name
            moves.append((path, dest_path))

    # ── 4. Handle ungrouped files (no album tag) ──────────────────────────────
    # Group them by artist from the tag or filename, create "Singles" buckets
    solo_by_artist = defaultdict(list)
    truly_unknown  = []
    for path in ungrouped:
        meta   = file_meta[path]
        artist = meta['artist']
        if not artist:
            # Try to parse "Artist - Title" from filename
            m = re.match(r'^(.+?)\s+-\s+.+$', path.stem)
            artist = m.group(1).strip() if m else ''
        if artist:
            solo_by_artist[artist].append(path)
        else:
            truly_unknown.append(path)

    for artist, paths in sorted(solo_by_artist.items()):
        if len(paths) >= 2:
            # Group as "Artist - Singles (Various)"
            folder_name = build_folder_name(artist, 'Singles', 'Various', 'MP3')
            target_dir  = dest / folder_name
            for path in paths:
                moves.append((path, target_dir / path.name))
        else:
            skipped.extend(paths)

    skipped.extend(truly_unknown)

    # ── 5. Print plan ─────────────────────────────────────────────────────────
    print("=" * 72)
    print(f"PLAN: {len(moves)} files to move into {len(set(str(d.parent) for _, d in moves))} folders")
    print(f"      {len(skipped)} files will be left in place")
    print()

    # Show grouped moves
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

    # ── 6. Execute ────────────────────────────────────────────────────────────
    if DRY_RUN:
        print("DRY RUN complete. Set DRY_RUN = False to execute.")
        return

    print("Executing moves...")
    errors = []
    moved  = 0

    for src_path, dst_path in moves:
        try:
            dst_path.parent.mkdir(parents=True, exist_ok=True)
            if src_path == dst_path:
                continue
            shutil.move(str(src_path), str(dst_path))
            moved += 1
        except Exception as e:
            errors.append((src_path, dst_path, str(e)))
            print(f"  ERROR: {src_path.name} → {e}")

    # Clean up empty source directories
    for dirpath, dirnames, filenames in os.walk(src, topdown=False):
        dirpath = Path(dirpath)
        if dirpath == src:
            continue
        try:
            remaining = [f for f in dirpath.iterdir() if not f.name.startswith('.')]
            if not remaining:
                dirpath.rmdir()
                print(f"  Removed empty dir: {dirpath.relative_to(src)}")
        except:
            pass

    print(f"\nDone. Moved {moved} files.")
    if errors:
        print(f"Errors: {len(errors)}")
        for s, d, e in errors:
            print(f"  {s.name}: {e}")


if __name__ == '__main__':
    process()
