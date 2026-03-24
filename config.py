"""
config.py
---------
Central configuration for all audiolibrary_tools scripts.
Edit this file to configure paths, credentials, and behavior.
"""

from pathlib import Path

ROOT_DIR = Path(__file__).parent
DATA_DIR = ROOT_DIR / "data"

# ── ORGANIZER ─────────────────────────────────────────────────────────────────

DRY_RUN               = True          # set False to actually move/rename files
MUSIC_PROCESS_DIR     = r"D:\MUSIC\TO PROCESS"
MUSIC_LIBRARY_DIR     = r"D:\MUSIC\REDACTED"
MIN_TRACKS_FOR_FOLDER = 1
CACHE_FILE            = r"D:\MUSIC\organize_cache.json"
LOG_FILE              = r"D:\MUSIC\organize_plan.txt"
SKIP_FOLDERS: set     = set()         # folder names to skip during scan

# ── YT_SLSK ───────────────────────────────────────────────────────────────────

YOUTUBE_URL     = "https://youtube.com/playlist?list=PLbGg3INHWHkzX9G_J3XxDtKw3KoACjMnS"
SLSKD_CMD       = str(ROOT_DIR / "tools" / "sldl" / "sldl.exe")
SLSK_OUTPUT_DIR = MUSIC_PROCESS_DIR
REVIEW_DIR      = SLSK_OUTPUT_DIR + r"\_NEEDS_REVIEW"

# ── RED_MATCH ─────────────────────────────────────────────────────────────────

RED_API_KEY    = "4dbb8953.c44b57d5f7349e80a13a01e6762fe584"
RED_PASSKEY    = "36f18a11cb74306dc29c14719a62769d"
RED_BASE_URL   = "https://redacted.sh"

QBT_HOST       = "http://kodisrv:8080"
QBT_USERNAME   = "ampleyan"
QBT_PASSWORD   = "Xus70aiaf71"

LOCAL_FOLDER         = r"D:\MUSIC\REDACTED"
TORRENT_DIR          = r"D:\MUSIC\TORRENTS"
RED_DEST_DIR         = r"D:\MUSIC\REDACTED"
UPLOAD_DIR           = r"D:\MUSIC\UPLOAD_CANDIDATES"
PUBLIC_DL_DIR        = r"D:\MUSIC\REDACTED\TO_COMPLETE"
COMPLETION_LOG_FILE  = r"D:\MUSIC\REDACTED\completion_log.json"
MATCH_CACHE_FILE     = r"D:\MUSIC\red_match_cache.json"

PROWLARR_URL     = "http://kodisrv:9696"
PROWLARR_API_KEY = "784837cfcf9e47dab431c0acdb59fcb9"

RED_OXIDE_BIN          = r""
RED_OXIDE_TRANSCODE_DIR = r"D:\MUSIC\TRANSCODES"
RED_OXIDE_FORMATS      = ['mp3320', 'mp3-v0']
RED_OXIDE_AUTO_UPLOAD  = False

SORT_BY_FORMAT = False
FORMAT_DIRS = {
    'FLAC': r"D:\MUSIC\REDACTED\flac",
    'MP3':  r"D:\MUSIC\REDACTED\mp3",
    'AAC':  r"D:\MUSIC\REDACTED\aac",
    'OGG':  r"D:\MUSIC\REDACTED\ogg",
    'WAV':  r"D:\MUSIC\REDACTED\wav",
}
LOOSE_DIR = r"D:\MUSIC\REDACTED\LOOSE"

RED_SIZE_TOLERANCE = 0.005
RED_MIN_NAME_SIM   = 0.55
RED_DRY_RUN        = True

RED_SKIP_FOLDERS = {
    'complete', 'downloading', 'new', 'onlyraretracks', 'FAKES',
    'FOLDERS TO CHECK', 'IN PROGRESS', 'REV', 'Sort 2 Single Trax',
    'New folder (2)', 'MUSIC', 'CHECK', 'oef', 'soulseek_batch_tracks',
    'Roxy lijst 1',
}

# ── NAVIDROME ─────────────────────────────────────────────────────────────────

NAVIDROME_DB_PATH      = "/home/ampleyan/config/navidrome/navidrome.db"
NAVIDROME_MUSIC_FOLDER = "/mnt/media/MUSIC"
