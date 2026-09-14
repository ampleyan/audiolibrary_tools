"""
py/yt_fetch.py
--------------
Universal playlist fetcher: YouTube, Spotify, Apple Music.
Called by the Tauri backend via subprocess.

Usage: python yt_fetch.py <url> [yt_cookies_file]
Spotify credentials via env: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
Each output line is a JSON object matching TrackDraft.
"""

import sys
import os
import re
import json
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from lib.queue import clean_title


# ── Shared helpers ─────────────────────────────────────────────────────────────

def _extract_mix_version(title):
    match = re.search(
        r'\s*[\(\[]([\w\s\-\'&]* '
        r'(?:original|extended|radio|club|dub|instrumental|vocal|acapella|vip|'
        r'remix|rmx|mix|edit|version|rework|bootleg|re-?edit|re-?work|re-?mix))'
        r'[\)\]]\s*$',
        title, flags=re.I
    )
    if match:
        return title[:match.start()].strip(), match.group(1).strip()
    return title, None


def _make_draft(artist, raw_title, source_url=None):
    title, mix_version = _extract_mix_version(raw_title)
    ok = bool(artist and title)
    return {
        "artist": artist or "",
        "title": title,
        "mix_version": mix_version,
        "source_url": source_url,
        "state": "requested" if ok else "needs_review",
    }


def _detect_service(url):
    host = urlparse(url).netloc.lower()
    if "spotify.com" in host:
        return "spotify"
    if "music.apple.com" in host or "itunes.apple.com" in host:
        return "apple_music"
    return "youtube"


# ── YouTube ────────────────────────────────────────────────────────────────────

def _ensure_netscape(cookies_file):
    import math
    p = Path(cookies_file)
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            return str(p)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return str(p)
    lines = ["# Netscape HTTP Cookie File"]
    for c in data:
        domain = c.get("domain", "")
        domain_flag = "FALSE" if c.get("hostOnly", True) else "TRUE"
        path = c.get("path", "/")
        secure = "TRUE" if c.get("secure", False) else "FALSE"
        exp = c.get("expirationDate") or c.get("expiry") or 0
        expires = str(int(math.floor(float(exp)))) if exp else "0"
        lines.append("\t".join([domain, domain_flag, path, secure, expires, c.get("name", ""), c.get("value", "")]))
    out = p.with_suffix(".txt")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return str(out)


def _playlist_url(url):
    import urllib.parse as up
    parsed = up.urlparse(url)
    qs = up.parse_qs(parsed.query)
    if "list" in qs and parsed.path in ("/watch", "/watch/"):
        return "https://www.youtube.com/playlist?list=" + qs["list"][0]
    return url


def _parse_yt_entry(entry):
    raw_title = entry.get("title", "") or ""
    artist, title, ok = clean_title(raw_title)
    if not ok or not artist:
        desc = entry.get("description", "") or ""
        for line in desc.splitlines():
            line = line.strip()
            if " · " in line and "Provided to YouTube" not in line and "℗" not in line:
                parts = [p.strip() for p in line.split(" · ")]
                if len(parts) >= 2 and parts[1]:
                    artist, ok = parts[1], True
                    break
            if " - " in line and not artist:
                parts = line.split(" - ", 1)
                if len(parts) == 2 and 2 < len(parts[0]) < 60 and len(parts[1]) > 2:
                    artist, title, ok = parts[0].strip(), parts[1].strip(), True
                    break
    title, mix_version = _extract_mix_version(title)
    return {
        "artist": artist,
        "title": title,
        "mix_version": mix_version,
        "source_url": entry.get("webpage_url") or entry.get("url"),
        "state": "requested" if ok else "needs_review",
    }


def _fetch_youtube(url, cookies_file=None):
    import yt_dlp
    opts = {
        "quiet": True,
        "extract_flat": "in_playlist",
        "ignoreerrors": True,
        "noplaylist": False,
    }
    if cookies_file:
        resolved = _ensure_netscape(cookies_file)
        if resolved:
            opts["cookiefile"] = resolved
    target = _playlist_url(url)
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(target, download=False)
        if not info:
            return
        entries = list(info.get("entries") or [])
        if not entries:
            entries = [info]
        for entry in entries:
            if entry:
                yield _parse_yt_entry(entry)


# ── Spotify ────────────────────────────────────────────────────────────────────

def _fetch_spotify(url):
    import requests

    client_id = os.environ.get("SPOTIFY_CLIENT_ID", "").strip()
    client_secret = os.environ.get("SPOTIFY_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise RuntimeError(
            "Spotify credentials not configured. "
            "Go to Settings → Spotify and add your Client ID and Client Secret. "
            "(Free Spotify Developer account at developer.spotify.com)"
        )

    m = re.search(r"playlist/([A-Za-z0-9]+)", url)
    if not m:
        raise ValueError("Could not extract Spotify playlist ID from URL")
    playlist_id = m.group(1)

    token_resp = requests.post(
        "https://accounts.spotify.com/api/token",
        data={"grant_type": "client_credentials"},
        auth=(client_id, client_secret),
        timeout=15,
    )
    token_resp.raise_for_status()
    token = token_resp.json()["access_token"]

    headers = {"Authorization": f"Bearer {token}"}
    api_url = (
        f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks"
        f"?limit=100&fields=items(track(name,artists(name))),next"
    )
    while api_url:
        resp = requests.get(api_url, headers=headers, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        for item in data.get("items", []):
            track = item.get("track")
            if not track:
                continue
            artist = ", ".join(a["name"] for a in track.get("artists", []))
            yield _make_draft(artist, track.get("name", ""))
        api_url = data.get("next")


# ── Apple Music ────────────────────────────────────────────────────────────────

def _fetch_apple_music(url):
    import requests

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
    }
    resp = requests.get(url, headers=headers, timeout=20)
    resp.raise_for_status()
    resp.encoding = "utf-8"

    ld_blocks = re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        resp.text, re.DOTALL | re.IGNORECASE,
    )
    for block in ld_blocks:
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        if data.get("@type") not in ("MusicPlaylist", "MusicAlbum"):
            continue
        tracks = data.get("track", [])
        if not tracks:
            continue
        for t in tracks:
            name = t.get("name", "")
            by_artist = t.get("byArtist", {})
            if isinstance(by_artist, list):
                artist = ", ".join(
                    a.get("name", "") for a in by_artist if isinstance(a, dict)
                )
            elif isinstance(by_artist, dict):
                artist = by_artist.get("name", "")
            else:
                artist = ""
            yield _make_draft(artist, name, source_url=t.get("url"))
        return

    serialized = re.search(
        r'<script[^>]*id=["\']serialized-server-data["\'][^>]*>(.*?)</script>',
        resp.text,
        re.DOTALL | re.IGNORECASE,
    )
    if serialized:
        try:
            data = json.loads(serialized.group(1))
        except json.JSONDecodeError:
            data = None

        def walk(value):
            if isinstance(value, dict):
                item_id = value.get("id", "")
                if isinstance(item_id, str) and item_id.startswith("track-lockup - ") and value.get("title") and value.get("artistName"):
                    yield _make_draft(value["artistName"], value["title"], source_url=url)
                for child in value.values():
                    yield from walk(child)
            elif isinstance(value, list):
                for child in value:
                    yield from walk(child)

        if data:
            found = list(walk(data))
            if found:
                yield from found
                return

    raise RuntimeError(
        "Could not find track listing on this Apple Music page. "
        "Only public playlists are supported."
    )


# ── Entry point ────────────────────────────────────────────────────────────────

def fetch(url, cookies_file=None):
    service = _detect_service(url)
    if service == "spotify":
        yield from _fetch_spotify(url)
    elif service == "apple_music":
        yield from _fetch_apple_music(url)
    else:
        yield from _fetch_youtube(url, cookies_file)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: yt_fetch.py <url> [cookies_file]"}), file=sys.stderr)
        sys.exit(1)
    cookies = sys.argv[2] if len(sys.argv) > 2 else None
    try:
        for draft in fetch(sys.argv[1], cookies):
            print(json.dumps(draft, ensure_ascii=True), flush=True)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
