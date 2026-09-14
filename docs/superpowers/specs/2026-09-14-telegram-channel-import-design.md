# Telegram channel YouTube import

## Goal

Allow importing YouTube links posted in the Telegram channel `-1002508065505` and convert those links into normal DJ Prep Tool library tracks.

## Scope

- Authenticate one Telegram user locally through MTProto/Telethon.
- Fetch channel history by numeric chat ID with pagination.
- Extract YouTube video, Shorts, and playlist URLs from message text and captions.
- Resolve each URL through the existing `yt_fetch.py` metadata flow.
- Insert resolved tracks through the existing SQLite import path, preserving source URLs and duplicate behavior.
- Show fetch progress, imported count, skipped links, and actionable errors in the Import view.

## Authentication and storage

- Add Telegram API ID and API hash settings as secret values, never returned in `PublicSettings`.
- Store the Telethon session in the app-local data directory, outside the repository.
- Add an explicit login action that requests the phone number and one-time code without logging either value.
- Never pass Telegram secrets in command-line arguments or write them to logs.
- Require the authenticated account to already be a member of the channel.

## Data flow

1. User opens Telegram import in Import view and enters the numeric channel ID and optional message limit.
2. Frontend calls a Tauri command to ensure the local Telegram session is authorized.
3. The command invokes a Python helper that reads channel messages and emits newline-delimited YouTube URLs with message links.
4. Rust invokes the existing YouTube metadata helper for each unique URL.
5. Rust inserts each `TrackDraft` through the existing importer and returns a summary.
6. Frontend merges added tracks into the current list and displays skipped or failed URLs.

## Error handling

- Missing API credentials: direct the user to Settings.
- Not authorized: show a login action and do not begin history fetch.
- Channel inaccessible: report membership or permission failure with the numeric ID.
- Malformed or unsupported URLs: skip individually and continue.
- YouTube metadata failure: report the URL and continue processing other links.
- Zero links: show a clear no-YouTube-links result.

## Testing and verification

- Unit-test URL extraction for message text, captions, duplicates, Shorts, and playlist links.
- Test that credentials and phone/code values are absent from emitted output.
- Test the Rust summary path with mixed success and failure results.
- Run Python tests, `npx tsc --noEmit`, frontend build, and `cargo check`.

## Non-goals

- Downloading Telegram audio files.
- Bot API support for future channel posts.
- Scraping Telegram Web browser state.
- Importing arbitrary Telegram chats without an explicit channel ID.
