"""
py/cosine_fetch.py
------------------
Find similar tracks via cosine.club REST API.

Steps:
  1. Search /api/v1/search?q=artist+title  →  get candidate track IDs
  2. Pick best match by artist/title similarity
  3. GET /api/v1/tracks/{id}/similar       →  100 similar tracks with scores

Usage:
  python cosine_fetch.py <artist> <title>

Credentials:
  COSINE_API_KEY env var (stored in app settings, never on command line)

Output: newline-delimited JSON — artist, title, mix_version, video_url, cosine_id, score
"""

import sys
import os
import re
import json
import unicodedata


def _norm(s):
    s = unicodedata.normalize("NFC", s).lower()
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _match_score(result, artist, title):
    ra = _norm(result.get("artist", ""))
    rt = _norm(result.get("track", ""))
    a = _norm(artist)
    t = _norm(title)

    def overlap(x, y):
        if not x or not y:
            return 0.0
        if x == y:
            return 1.0
        if x in y or y in x:
            return 0.8
        words_x = set(w for w in x.split() if len(w) > 2)
        words_y = set(w for w in y.split() if len(w) > 2)
        if not words_x or not words_y:
            return 0.0
        common = words_x & words_y
        return len(common) / max(len(words_x), len(words_y))

    return overlap(a, ra) * 2 + overlap(t, rt)


def _extract_mix_version(title):
    match = re.search(
        r"\s*[\(\[]([\w\s\-\'&]* "
        r"(?:original|extended|radio|club|dub|instrumental|vocal|acapella|vip|"
        r"remix|rmx|mix|edit|version|rework|bootleg|re-?edit|re-?work|re-?mix))"
        r"[\)\]]\s*$",
        title,
        flags=re.I,
    )
    if match:
        return title[: match.start()].strip(), match.group(1).strip()
    return title, None


def fetch(artist, title, api_key):
    import urllib.request
    import urllib.parse

    def get(url):
        req = urllib.request.Request(
            url, headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode())

    # 1. Search for the track
    q = urllib.parse.quote(f"{artist} {title}")
    search_data = get(f"https://cosine.club/api/v1/search?q={q}")
    candidates = search_data.get("data", [])

    if not candidates:
        raise RuntimeError(
            f"No tracks found on cosine.club for: {artist} – {title}. "
            "Their catalog is primarily Discogs-sourced; the track may not be indexed."
        )

    # 2. Pick best match
    best = max(candidates, key=lambda r: _match_score(r, artist, title))
    cosine_id = best["id"]

    # 3. Get similar tracks
    similar_data = get(f"https://cosine.club/api/v1/tracks/{cosine_id}/similar")
    similar = similar_data.get("data", {}).get("similar_tracks", [])

    for t in similar:
        raw_title = t.get("track", "")
        clean_title, mix_version = _extract_mix_version(raw_title)
        yield {
            "artist": t.get("artist", ""),
            "title": clean_title,
            "mix_version": mix_version,
            "video_url": t.get("video_uri") or None,
            "cosine_id": str(t.get("id", "")),
            "score": round(t.get("score", 0), 4),
            "state": "requested",
        }


def main():
    if len(sys.argv) < 3:
        print(
            json.dumps({"error": "Usage: cosine_fetch.py <artist> <title>"}),
            file=sys.stderr,
        )
        sys.exit(1)

    api_key = os.environ.get("COSINE_API_KEY", "").strip()
    if not api_key:
        print(
            json.dumps({"error": "COSINE_API_KEY not set. Add your cosine.club API key in Settings."}),
            file=sys.stderr,
        )
        sys.exit(1)

    artist, title = sys.argv[1], sys.argv[2]
    try:
        for track in fetch(artist, title, api_key):
            print(json.dumps(track, ensure_ascii=False), flush=True)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
