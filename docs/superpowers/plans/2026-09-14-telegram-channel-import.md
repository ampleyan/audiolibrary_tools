# Telegram Channel Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import YouTube links from Telegram channel `-1002508065505` into the existing DJ Prep Tool library.

**Architecture:** A Python Telethon helper owns Telegram authentication, local session storage, history pagination, and URL extraction. Rust owns settings, subprocess orchestration, YouTube metadata resolution, and SQLite insertion. React adds settings fields and an Import tab that performs login and import with progress/result feedback.

**Tech Stack:** React/TypeScript, Tauri/Rust, Python 3.11, Telethon, existing `yt_fetch.py`, SQLite settings store.

**Spec:** `docs/superpowers/specs/2026-09-14-telegram-channel-import-design.md`

## Global Constraints

- Telegram API ID/hash and session data never enter tracked files or logs.
- Phone numbers and login codes are passed only through stdin to the helper.
- Existing YouTube metadata and SQLite import paths remain the source of truth.
- Python code has no type annotations and no inline comments.
- Each phase touches no more than five files.

---

### Task 1: Telegram URL extraction helper

**Files:**
- Create: `dj-prep-tool/py/telegram_fetch.py`
- Create: `dj-prep-tool/py/test_telegram_fetch.py`

**Interfaces:**
- Produces `extract_youtube_urls(text) -> list[str]` with normalized, deduplicated YouTube URLs.
- Produces a CLI that reads JSON requests from stdin and emits JSON responses on stdout.

- [ ] Write failing tests for watch URLs, short URLs, Shorts, playlist URLs, duplicate links, and missing text.
- [ ] Run `python -m unittest py/test_telegram_fetch.py` and confirm the extraction test fails because the helper does not exist.
- [ ] Implement extraction and the stdin JSON protocol without exposing credentials in output.
- [ ] Run the focused tests and confirm they pass.
- [ ] Commit `test: cover Telegram YouTube extraction` and `feat: add Telegram URL helper` as one focused commit.

### Task 2: Telegram settings and Rust orchestration

**Files:**
- Modify: `dj-prep-tool/src-tauri/src/config_store.rs`
- Modify: `dj-prep-tool/src-tauri/src/commands/import.rs`
- Modify: `dj-prep-tool/src-tauri/src/lib.rs`
- Modify: `dj-prep-tool/src/lib/api.ts`

**Interfaces:**
- Add `telegram_api_id`, `telegram_api_hash`, and `telegram_session_path` settings.
- Add commands `telegram_login` and `import_telegram`.
- `telegram_login(phone, code)` authorizes the local session.
- `import_telegram(channel_id, limit)` fetches URLs, invokes `yt_fetch.py`, and returns imported tracks plus skipped/error details.

- [ ] Add Rust unit coverage for URL import summary handling where practical.
- [ ] Run `cargo test` before implementation and record the baseline.
- [ ] Implement secret-safe settings and subprocess environment propagation.
- [ ] Implement Telegram login/import commands using newline-delimited JSON from the helper and the existing YouTube importer.
- [ ] Register commands and add typed frontend wrappers.
- [ ] Run `cargo test` and `cargo check`.

### Task 3: Import UI

**Files:**
- Modify: `dj-prep-tool/src/views/SetupView.tsx`
- Modify: `dj-prep-tool/src/views/ImportView.tsx`
- Modify: `dj-prep-tool/src/lib/types.ts`

**Interfaces:**
- Settings exposes Telegram API ID/hash fields and session status without returning secrets.
- Import view adds a Telegram tab with channel ID, history limit, login form, import button, progress, and per-link errors.

- [ ] Add state and controls for login and import without duplicating track state.
- [ ] Show the configured channel ID as the default while allowing another numeric channel ID.
- [ ] Merge imported tracks using the existing `run` helper and display skipped links.
- [ ] Run `npx tsc --noEmit` and `npm run build`.

### Task 4: Dependency and final verification

**Files:**
- Create or modify: `dj-prep-tool/requirements.txt`
- Modify: `dj-prep-tool/README-RPI5.md`

- [ ] Pin a compatible Telethon dependency without adding secrets.
- [ ] Document first-time Telegram API credential setup and local session behavior for Windows, macOS, and Raspberry Pi.
- [ ] Run Python tests, `npx tsc --noEmit`, `npm run build`, `cargo test`, `cargo check`, and `git diff --check`.
- [ ] Review the final diff for credential exposure and unrelated files.
