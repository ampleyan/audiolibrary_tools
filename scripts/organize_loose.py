"""
organize_loose.py
-----------------
Groups loose audio files in the process folder into album sub-folders.
Operates on flat files only (does not recurse into sub-directories).

Configuration: edit config.py at the project root.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import os, shutil
from collections import defaultdict

import config
from lib.musiclib import (
    AUDIO_EXT, build_folder_name,
    get_tags, get_artist, get_album, get_year, get_fmt,
)


def scan_loose_files(folder):
    results = []
    for entry in os.scandir(folder):
        if entry.is_file():
            ext = os.path.splitext(entry.name)[1].lower()
            if ext in AUDIO_EXT:
                results.append((entry.path, entry.name))
    return results


def main():
    print(f"SOURCE:   {config.MUSIC_PROCESS_DIR}")
    print(f"DRY RUN:  {config.DRY_RUN}")
    print()

    loose = scan_loose_files(config.MUSIC_PROCESS_DIR)
    print(f"Found {len(loose)} loose audio files.\n")

    file_tags = {}
    for path, fname in loose:
        file_tags[fname] = (path, get_tags(path))

    groups = defaultdict(list)
    for fname, (path, t) in file_tags.items():
        album = get_album(t)
        if not album:
            continue
        artist = get_artist(t) or 'Unknown Artist'
        year   = get_year(t)
        ext    = os.path.splitext(fname)[1].lower()
        groups[(artist, album, year, ext)].append(fname)

    groups = {k: v for k, v in groups.items() if len(v) >= config.MIN_TRACKS_FOR_FOLDER}
    print(f"Found {len(groups)} album groups with >= {config.MIN_TRACKS_FOR_FOLDER} tracks.\n")

    created, moved, errors = 0, 0, []

    for (artist, album, year, ext), fnames in sorted(groups.items()):
        smallest    = min(fnames, key=lambda f: os.path.getsize(file_tags[f][0]))
        fmt         = get_fmt(file_tags[smallest][0])
        folder_name = build_folder_name(artist, album, year, fmt)
        target_dir  = os.path.join(config.MUSIC_PROCESS_DIR, folder_name)

        print(f"  📁 {folder_name}  [{len(fnames)} tracks]")
        if not config.DRY_RUN:
            os.makedirs(target_dir, exist_ok=True)
        created += 1

        for fname in sorted(fnames):
            src = file_tags[fname][0]
            dst = os.path.join(target_dir, fname)
            if os.path.exists(dst):
                print(f"    – already exists, skipping: {fname[:70]}")
                continue
            print(f"    {'→' if config.DRY_RUN else '✓'} {fname[:70]}")
            if not config.DRY_RUN:
                try:
                    shutil.move(src, dst)
                    moved += 1
                except Exception as e:
                    print(f"    ✗ ERROR: {e}")
                    errors.append((fname, str(e)))

    print()
    print("=" * 60)
    total_files = sum(len(v) for v in groups.values())
    if config.DRY_RUN:
        print(f"DRY RUN complete. Would create {created} folders, move {total_files} files.")
        print("Set DRY_RUN = False in config.py to apply changes.")
    else:
        print(f"Done. Created {created} folders, moved {moved} files.")
    if errors:
        print(f"\nErrors ({len(errors)}):")
        for name, err in errors:
            print(f"  {name}: {err}")


if __name__ == '__main__':
    main()
