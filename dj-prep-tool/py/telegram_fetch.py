import json
import re
import sys
from urllib.parse import parse_qs, urlsplit, urlunsplit


YOUTUBE_URL = re.compile(
    r"https?://(?:www\.)?(?:youtube\.com/(?:watch\?[^\s<>\"]+|shorts/[A-Za-z0-9_-]+(?:\?[^\s<>\"]*)?|playlist\?[^\s<>\"]+)|youtu\.be/[A-Za-z0-9_-]+(?:\?[^\s<>\"]*)?)",
    re.IGNORECASE,
)


def normalize_youtube_url(url):
    url = url.rstrip(".,!?;:)]}")
    parts = urlsplit(url)
    host = parts.netloc.lower()
    if host == "youtu.be":
        video_id = parts.path.strip("/").split("/")[0]
        return f"https://youtu.be/{video_id}" if video_id else None
    path = parts.path.rstrip("/")
    query = parse_qs(parts.query)
    if path == "/watch" and query.get("v"):
        return f"https://www.youtube.com/watch?v={query['v'][0]}"
    if path.startswith("/shorts/"):
        video_id = path.split("/", 2)[2]
        return f"https://www.youtube.com/shorts/{video_id}" if video_id else None
    if path == "/playlist" and query.get("list"):
        return f"https://www.youtube.com/playlist?list={query['list'][0]}"
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


def extract_youtube_urls(text):
    found = []
    seen = set()
    for raw_url in YOUTUBE_URL.findall(text or ""):
        url = normalize_youtube_url(raw_url)
        if url and url not in seen:
            seen.add(url)
            found.append(url)
    return found


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        if request.get("action") != "extract":
            raise ValueError("unsupported action")
        print(json.dumps({"urls": extract_youtube_urls(request.get("text", ""))}), flush=True)


if __name__ == "__main__":
    main()
