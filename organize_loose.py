"""
organize_loose.py
-----------------
Groups loose audio files in SOURCE_DIR into album folders using ID3/Vorbis metadata.
Folder naming convention: Artist - Album (Year) - Format Bitrate
  e.g.  DJ Shufflemaster - EXP (2001) - MP3 320

Requirements:  pip install mutagen

CONFIG – edit these three lines before running:
"""

SOURCE_DIR  = r"D:\MUSIC\TO PROCESS"   # folder containing loose audio files
DRY_RUN     = True                     # set False to actually move files
MIN_TRACKS  = 2                        # minimum tracks to form a folder group

# ---------------------------------------------------------------------------

import os, re, shutil
from collections import defaultdict

from musiclib import (
    AUDIO_EXT, safe_name, build_folder_name,
    get_tags, get_artist, get_album, get_year, get_fmt,
)


def scan_loose_files(folder):
    """Return list of (full_path, filename) for loose audio files directly in folder."""
    results = []
    for entry in os.scandir(folder):
        if entry.is_file():
            ext = os.path.splitext(entry.name)[1].lower()
            if ext in AUDIO_EXT:
                results.append((entry.path, entry.name))
    return results


def main():
    print(f"SOURCE:   {SOURCE_DIR}")
    print(f"DRY RUN:  {DRY_RUN}")
    print()

    loose = scan_loose_files(SOURCE_DIR)
    print(f"Found {len(loose)} loose audio files.\n")

    # Read tags for all files
    file_tags = {}
    for path, fname in loose:
        t = get_tags(path)
        file_tags[fname] = (path, t)

    # Group by (artist, album, year, ext)
    groups = defaultdict(list)
    for fname, (path, t) in file_tags.items():
        album = get_album(t)
        if not album:
            continue
        artist = get_artist(t) or 'Unknown Artist'
        year   = get_year(t)
        ext    = os.path.splitext(fname)[1].lower()
        key    = (artist, album, year, ext)
        groups[key].append(fname)

    # Filter to groups with enough tracks
    groups = {k: v for k, v in groups.items() if len(v) >= MIN_TRACKS}
    print(f"Found {len(groups)} album groups with >= {MIN_TRACKS} tracks.\n")

    created = 0
    moved   = 0
    errors  = []

    for (artist, album, year, ext), fnames in sorted(groups.items()):
        # Detect format from the smallest file
        smallest = min(fnames, key=lambda f: os.path.getsize(file_tags[f][0]))
        fmt = get_fmt(file_tags[smallest][0])

        folder_name = build_folder_name(artist, album, year, fmt)
        target_dir  = os.path.join(SOURCE_DIR, folder_name)

        print(f"  📁 {folder_name}  [{len(fnames)} tracks]")

        if not DRY_RUN:
            os.makedirs(target_dir, exist_ok=True)
        created += 1

        for fname in sorted(fnames):
            src = file_tags[fname][0]
            dst = os.path.join(target_dir, fname)

            if os.path.exists(dst):
                print(f"    – already exists, skipping: {fname[:70]}")
                continue

            print(f"    {'→' if DRY_RUN else '✓'} {fname[:70]}")
            if not DRY_RUN:
                try:
                    shutil.move(src, dst)
                    moved += 1
                except Exception as e:
                    print(f"    ✗ ERROR: {e}")
                    errors.append((fname, str(e)))

    print()
    print("=" * 60)
    if DRY_RUN:
        print(f"DRY RUN complete. Would create {created} folders, move {len([f for g in groups.values() for f in g])} files.")
        print("Set DRY_RUN = False at the top of this script to apply changes.")
    else:
        print(f"Done. Created {created} folders, moved {moved} files.")
    if errors:
        print(f"\nErrors ({len(errors)}):")
        for name, err in errors:
            print(f"  {name}: {err}")


if __name__ == '__main__':
    main()
