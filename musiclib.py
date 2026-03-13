"""
musiclib.py
-----------
Shared utilities for audio metadata reading and folder naming.
Used by organize_music.py, organize_loose.py, rename_folders.py, red_match.py.
"""

import re
import sys
from pathlib import Path

try:
    from mutagen import File as MutagenFile
    from mutagen.mp3 import MP3
    from mutagen.flac import FLAC
except ImportError:
    print("ERROR: mutagen is not installed.  Run: pip install mutagen")
    sys.exit(1)

# ─── CONSTANTS ────────────────────────────────────────────────────────────────

AUDIO_EXT = {'.mp3', '.flac', '.m4a', '.ogg', '.wav', '.aac', '.wma', '.opus'}

JUNK_ALBUM_TAGS = {
    'www.electronicfresh.com', 'electronicfresh.com', 'clapcrate.me',
    'www.groovytunes.org', 'traxcrate.com', 'sharing-db.com',
}

# ─── HELPERS ──────────────────────────────────────────────────────────────────

def safe_name(s):
    """Strip characters illegal in Windows folder names and collapse underscores."""
    s = str(s).strip()
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', s)
    s = re.sub(r'_+', '_', s)
    return s.rstrip('. ') or 'Unknown'


def get_tags(filepath):
    """
    Read all tags from an audio file.
    Returns a dict with all keys lowercased.  Empty dict on failure.
    """
    try:
        audio = MutagenFile(str(filepath), easy=False)
        if not audio or not audio.tags:
            return {}
        t = {}
        for k, v in audio.tags.items():
            val = v[0] if isinstance(v, list) else v
            t[k.lower()] = str(val).strip()
        return t
    except Exception:
        return {}


def get_artist(t):
    """Album artist (TPE2) preferred over track artist (TPE1)."""
    a = (t.get('tpe2') or t.get('albumartist') or
         t.get('tpe1') or t.get('artist') or '')
    if re.match(r'https?://', a):
        a = 'Various Artists'
    return a.strip()


def get_album(t):
    """Album title, stripping download-site watermarks and URL tags."""
    a = (t.get('talb') or t.get('album') or '').strip()
    if a.lower() in JUNK_ALBUM_TAGS or re.match(r'https?://|www\.', a.lower()):
        return ''
    return a


def get_year(t):
    """
    Best available release year.
    Checks originalyear first (preferred for reissues), then date/year fields.
    """
    for key in ('originalyear', 'txxx:originalyear', 'originaldate',
                'tdor', 'tdrc', 'date', 'year'):
        v = t.get(key, '')
        m = re.search(r'\b(1[89]\d\d|20[012]\d)\b', str(v))
        if m:
            return m.group(1)
    return ''


def get_fmt_bitrate(filepath):
    """
    Return (format_string, bitrate_kbps).
    bitrate_kbps is 0 for non-MP3 formats.
    """
    ext = Path(filepath).suffix.lower()
    try:
        if ext == '.mp3':
            br = MP3(str(filepath)).info.bitrate // 1000
            br = (320 if br >= 300 else
                  256 if br >= 240 else
                  192 if br >= 175 else
                  160 if br >= 140 else 128)
            return f'MP3 {br}', br
        elif ext == '.flac':
            bits = FLAC(str(filepath)).info.bits_per_sample
            return ('FLAC 24bit' if bits >= 24 else 'FLAC'), 0
        elif ext == '.m4a':
            return 'AAC', 0
        elif ext == '.ogg':
            return 'OGG', 0
        elif ext == '.wav':
            return 'WAV', 0
        else:
            return ext.lstrip('.').upper(), 0
    except Exception:
        return ext.lstrip('.').upper(), 0


def get_fmt(filepath):
    """Format string only (e.g. 'MP3 320', 'FLAC', 'FLAC 24bit')."""
    return get_fmt_bitrate(filepath)[0]


def read_metadata(path):
    """
    Read all relevant metadata from an audio file.
    Returns dict: artist, album, year, title, tracknumber, fmt, bitrate.
    """
    path = Path(path)
    result = {
        'artist': '', 'album': '', 'year': '', 'title': '',
        'tracknumber': '', 'fmt': '', 'bitrate': 0,
    }
    t = get_tags(path)
    result['artist']      = get_artist(t)
    result['album']       = get_album(t)
    result['year']        = get_year(t)
    result['title']       = (t.get('tit2') or t.get('title') or '')
    result['tracknumber'] = (t.get('trck') or t.get('tracknumber') or '')
    fmt, bitrate          = get_fmt_bitrate(path)
    result['fmt']         = fmt
    result['bitrate']     = bitrate
    return result


def build_folder_name(artist, album, year, fmt):
    """Canonical folder name: 'Artist - Album (Year) - Format'."""
    artist = safe_name(artist or 'Unknown Artist')
    album  = safe_name(album  or 'Unknown Album')
    year   = year or 'Unknown'
    fmt    = fmt  or 'Unknown'
    return f"{artist} - {album} ({year}) - {fmt}"
