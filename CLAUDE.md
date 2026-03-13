# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A collection of standalone Python scripts for organizing a music library. No package/module structure — each script runs independently.

## Running the Scripts

```bash
# Install dependency (only one)
pip install mutagen

# Or use the bat helper (runs organize_music.py in dry-run mode)
run_organizer.bat
```

Each script has a `DRY_RUN = True` flag at the top. Always run dry first, review the plan, then set `DRY_RUN = False`.

## Scripts

| Script | Purpose |
|--------|---------|
| `organize_music.py` | Scans a folder tree, groups audio by metadata, moves albums to `Artist - Album (Year) - Format` folders. Handles sub-folders and loose files. |
| `organize_loose.py` | Lighter version — groups *loose* audio files (flat directory only) into album folders in-place. |
| `rename_folders.py` | Renames *existing* album sub-folders to the standard naming convention. Has an `OVERRIDES` dict for folders that auto-detect incorrectly. |

## Configuration

Each script has a config block at the top:

- `SOURCE_DIR` / `DEST_DIR` — hardcoded Windows paths (e.g. `D:\MUSIC\TO PROCESS`)
- `DRY_RUN` — always `True` by default
- `SKIP_FOLDERS` — utility folder names to ignore
- `JUNK_ALBUM_TAGS` — download-site watermarks to strip from album tags
- `MIN_TRACKS_FOR_FOLDER` / `MIN_TRACKS` — minimum tracks before grouping into a folder

## Folder Naming Convention

```
Artist - Album (Year) - Format Bitrate
e.g.  DJ Shufflemaster - EXP (2001) - MP3 320
      Various Artists - Some Comp (2018) - FLAC
```

Format values: `MP3 320`, `MP3 256`, `MP3 192`, `MP3 160`, `MP3 128`, `FLAC`, `FLAC 24bit`, `AAC`, `OGG`, `WAV`

## Tag Priority

- **Artist**: TPE2 (album artist) → TPE1 (track artist) → albumartist → artist
- **Year**: originalyear → originaldate → date → TDRC (prefers original release year)
- **Album**: TALB → album; junk tags and URLs are stripped

## Key Shared Logic

`safe_name()`, `get_tags()`, `get_artist()`, `get_album()`, `get_year()`, `get_fmt()` are duplicated across all three scripts (no shared module). When fixing a bug in one, check the others.