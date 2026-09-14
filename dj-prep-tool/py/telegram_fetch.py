import json
import os
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


def session_state_path(session_path):
    return session_path + ".login.json"


def telegram_client(api_id, api_hash, session_path):
    from telethon import TelegramClient

    parent = os.path.dirname(session_path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    return TelegramClient(session_path, int(api_id), api_hash)


def login_start(request, api_id, api_hash, session_path):
    import asyncio

    async def run():
        client = telegram_client(api_id, api_hash, session_path)
        await client.connect()
        if await client.is_user_authorized():
            await client.disconnect()
            return {"status": "authorized"}
        sent = await client.send_code_request(request["phone"])
        with open(session_state_path(session_path), "w", encoding="utf-8") as state_file:
            json.dump({"phone": request["phone"], "phone_code_hash": sent.phone_code_hash}, state_file)
        await client.disconnect()
        return {"status": "code_required"}

    return asyncio.run(run())


def login_code(request, api_id, api_hash, session_path):
    import asyncio
    from telethon.errors import SessionPasswordNeededError

    with open(session_state_path(session_path), encoding="utf-8") as state_file:
        state = json.load(state_file)

    async def run():
        client = telegram_client(api_id, api_hash, session_path)
        await client.connect()
        try:
            await client.sign_in(
                phone=state["phone"],
                code=request["code"],
                phone_code_hash=state["phone_code_hash"],
            )
        except SessionPasswordNeededError:
            password = request.get("password")
            if not password:
                await client.disconnect()
                return {"status": "password_required"}
            await client.sign_in(password=password)
        await client.disconnect()
        return {"status": "authorized"}

    result = asyncio.run(run())
    if result["status"] == "authorized":
        try:
            import os
            os.remove(session_state_path(session_path))
        except FileNotFoundError:
            pass
    return result


def message_url(channel_id, message_id):
    value = str(channel_id)
    internal_id = value[4:] if value.startswith("-100") else value.lstrip("-")
    return f"https://t.me/c/{internal_id}/{message_id}"


def fetch_channel(request, api_id, api_hash, session_path):
    import asyncio

    async def run():
        client = telegram_client(api_id, api_hash, session_path)
        await client.connect()
        if not await client.is_user_authorized():
            await client.disconnect()
            raise RuntimeError("Telegram session is not authorized")
        entity = await client.get_entity(int(request["channel_id"]))
        results = []
        seen = set()
        async for message in client.iter_messages(entity, limit=int(request.get("limit", 100)), reverse=False):
            urls = extract_youtube_urls(message.message or "")
            for url in urls:
                if url in seen:
                    continue
                seen.add(url)
                results.append({
                    "url": url,
                    "message_url": message_url(request["channel_id"], message.id),
                })
        await client.disconnect()
        return results

    return asyncio.run(run())


def check_session(api_id, api_hash, session_path):
    import asyncio

    async def run():
        client = telegram_client(api_id, api_hash, session_path)
        await client.connect()
        authorized = await client.is_user_authorized()
        await client.disconnect()
        return {"status": "authorized" if authorized else "not_authorized"}

    return asyncio.run(run())


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        action = request.get("action")
        if action == "extract":
            result = {"urls": extract_youtube_urls(request.get("text", ""))}
        else:
            api_id = os.environ.get("TELEGRAM_API_ID")
            api_hash = os.environ.get("TELEGRAM_API_HASH")
            session_path = os.environ.get("TELEGRAM_SESSION_PATH")
            if not api_id or not api_hash or not session_path:
                raise ValueError("Telegram API credentials and session path are required")
            if action == "login_start":
                result = login_start(request, api_id, api_hash, session_path)
            elif action == "login_code":
                result = login_code(request, api_id, api_hash, session_path)
            elif action == "fetch":
                result = {"messages": fetch_channel(request, api_id, api_hash, session_path)}
            elif action == "check":
                result = check_session(api_id, api_hash, session_path)
            else:
                raise ValueError("unsupported action")
        print(json.dumps(result, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
