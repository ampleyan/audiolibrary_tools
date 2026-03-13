"""
rename_folders.py
-----------------
Renames existing album folders inside SOURCE_DIR to the standard convention:
  Artist - Album (Year) - Format Bitrate
  e.g.  Various Artists - Best of Pharma Relaunch - Year 1 (2018) - MP3 320

Reads metadata from audio files inside each folder to determine the correct name.
Falls back to parsing the folder name itself where metadata is missing.

Requirements:  pip install mutagen

CONFIG – edit before running:
"""

SOURCE_DIR = r"D:\MUSIC\TO PROCESS"   # folder containing album sub-folders
DRY_RUN    = False                      # set False to actually rename

# Known overrides – add any folder whose auto-detected name comes out wrong.
# Key = current folder name, Value = desired folder name (or None to auto-detect).
OVERRIDES = {
    'Hector - Activity｜1998｜S3 Frankfurt S3 664980 6｜Vinyl FLAC 24 - 96':
        'Hector - Activity (1998) - FLAC 24bit',
    'VA-Best_Of_Pharma_Relaunch-Year_1-PHARMAREC020-WEB-2018-BABAS':
        'Various Artists - Best of Pharma Relaunch - Year 1 (2018) - MP3 320',
    'VA-Best_Of_Pharma_Relaunch__Year_2-PHARMAREC031-WEB-2019-NDE':
        'Various Artists - Best of Pharma Relaunch - Year 2 (2019) - MP3 320',
    'Various Artists - 1988 - The Garage Sound of Deepest New York':
        'Various Artists - The Garage Sound of Deepest New York (1988) - FLAC',
    "[ELEK 073] Luke's Anger - Sound Clash (2010)":
        "Luke's Anger - Sound Clash (2010) - FLAC",
    '[SOMA006] Otaku - Percussion Obsession [1993]':
        'Otaku - Percussion Obsession (1993) - MP3 320',
    'The_X_Factor-Desert_Rain-(801436_0100180)-WEB-1995-iDF':
        'The X Factor - Desert Rain (1995) - MP3 320',
    # Add more here as needed. Example:
    # 'Bad Folder Name': 'Artist - Album (Year) - MP3 320',
    # 'Detect This One':  None,  # None = auto-detect from files inside
}

# Folders to completely ignore (system/work folders)
SKIP_FOLDERS = {
    'complete', 'downloading', 'new', 'onlyraretracks', 'FAKES',
    'FOLDERS TO CHECK', 'IN PROGRESS', 'REV', 'Sort 2 Single Trax',
    'New folder (2)', 'MUSIC', 'CHECK', 'oef', 'soulseek_batch_tracks',
}

# ---------------------------------------------------------------------------

import os, re, shutil

from musiclib import (
    AUDIO_EXT, safe_name, build_folder_name,
    get_tags, get_artist, get_album, get_year, get_fmt,
)

def find_audio_files(folder):
    results = []
    for root, dirs, files in os.walk(folder):
        for f in files:
            if os.path.splitext(f)[1].lower() in AUDIO_EXT:
                results.append(os.path.join(root, f))
    return results

def auto_detect_name(folder_path, folder_name):
    """Read first audio file's tags and build a folder name from them."""
    audio_files = find_audio_files(folder_path)
    if not audio_files:
        return None

    # Use the smallest file for fast tag reading
    ref = min(audio_files, key=os.path.getsize)
    t   = get_tags(ref)
    fmt = get_fmt(ref)

    artist = get_artist(t)
    album  = get_album(t)
    year   = get_year(t)

    # Fallback: parse from folder name if metadata is sparse
    if not artist or not album:
        clean = re.sub(r'\[.*?\]', '', folder_name).strip()
        clean = re.sub(r'^VA[-_\s]+', 'Various Artists - ', clean, flags=re.I)
        clean = re.sub(r'^Various\s*[-_]\s*', 'Various Artists - ', clean, flags=re.I)
        clean = re.sub(r'-WEB.*$|_WEB.*$|WEB-.*$', '', clean).strip('_- ')
        clean = clean.replace('_', ' ')

        if not artist:
            parts = clean.split(' - ')
            artist = parts[0].strip() if parts else 'Unknown Artist'
        if not album:
            parts = clean.split(' - ')
            raw_album = ' - '.join(parts[1:]) if len(parts) > 1 else clean
            raw_album = re.sub(r'\s*[\(\[]\s*(1[89]\d\d|20[012]\d)\s*[\)\]]', '', raw_album)
            album = raw_album.strip() or folder_name

    if not year:
        m = re.search(r'\b(1[89]\d\d|20[012]\d)\b', folder_name)
        if m:
            year = m.group(1)

    return build_folder_name(artist, album, year, fmt)


def main():
    print(f"SOURCE:   {SOURCE_DIR}")
    print(f"DRY RUN:  {DRY_RUN}")
    print()

    entries = [e for e in os.scandir(SOURCE_DIR)
               if e.is_dir() and e.name not in SKIP_FOLDERS and not e.name.startswith('.')]
    print(f"Found {len(entries)} sub-folders to check.\n")

    renamed = 0
    skipped = 0
    errors  = []

    for entry in sorted(entries, key=lambda e: e.name):
        fd   = entry.name
        path = entry.path

        # Already looks correct?  Artist - Album (Year) - Format
        if re.match(r'^.+ - .+ \(\d{4}\) - (MP3|FLAC|WAV|AAC|M4A)', fd):
            print(f"  ✓ already correct: {fd}")
            skipped += 1
            continue

        # Use override if provided
        if fd in OVERRIDES:
            new_name = OVERRIDES[fd]
            if new_name is None:
                new_name = auto_detect_name(path, fd)
        else:
            new_name = auto_detect_name(path, fd)

        if not new_name:
            contents = [f for f in os.listdir(path) if not f.startswith('.')]
            print(f"  🗑  no audio, removing ({len(contents)} file(s)): {fd}")
            if not DRY_RUN:
                shutil.rmtree(path)
            skipped += 1
            continue

        if new_name == fd:
            print(f"  ✓ already correct: {fd}")
            skipped += 1
            continue

        new_path = os.path.join(SOURCE_DIR, new_name)

        print(f"  RENAME:")
        print(f"    FROM: {fd}")
        print(f"    TO:   {new_name}")

        if not DRY_RUN:
            if os.path.exists(new_path):
                print(f"    ✗ target already exists, skipping")
                errors.append((fd, "target exists"))
                continue
            try:
                os.rename(path, new_path)
                renamed += 1
                print(f"    ✓ done")
            except Exception as e:
                print(f"    ✗ ERROR: {e}")
                errors.append((fd, str(e)))
        else:
            renamed += 1

        print()

    print("=" * 60)
    if DRY_RUN:
        print(f"DRY RUN complete. Would rename {renamed} folders (skipped {skipped} already-correct).")
        print("Set DRY_RUN = False at the top of this script to apply changes.")
    else:
        print(f"Done. Renamed {renamed} folders (skipped {skipped}).")
    if errors:
        print(f"\nErrors ({len(errors)}):")
        for name, err in errors:
            print(f"  {name}: {err}")


if __name__ == '__main__':
    main()
