# DJ Prep Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add confidence-gated tagging and Rekordbox handoff, selected cosine imports, and safe per-view batch actions.

**Architecture:** Rust remains the authority for persistent state, duplicate detection, file actions, and subprocess execution. React retains only view-local selection and rendering state. A managed beets profile lives in app data, keeps its own library database, and moves accepted files to the configured music-library directory.

**Tech Stack:** Tauri 2, Rust, rusqlite, React 18, TypeScript, Python 3.11+, beets.

**Spec:** `docs/superpowers/specs/2026-09-13-dj-prep-tagging-cosine-batches-design.md`

## Global Constraints

- Never expose credentials in logs, stdout, UI state, source, or committed files.
- The managed beets configuration contains no credentials.
- All configured paths are stored in SQLite settings; no user path is hard-coded.
- Strong matches alone may move files automatically; ambiguous metadata requires review.
- Output names are `Artist - Title.ext` or `Artist - Title (Mix Version).ext`.
- Rekordbox reads the music-library file directly; the app never creates a duplicate.
- Windows is the primary platform; file moves must reject traversal and collisions.
- Each implementation phase changes no more than five files, is verified, and pauses for approval.
- Run `npx tsc --noEmit` in `dj-prep-tool` and `cargo check` in `dj-prep-tool/src-tauri` before completing any phase.

---

### Task 1: Add tagging state and non-secret configuration

**Files:**
- Modify: `dj-prep-tool/src-tauri/src/config_store.rs`
- Modify: `dj-prep-tool/src-tauri/src/commands/import.rs`
- Modify: `dj-prep-tool/src/lib/types.ts`
- Modify: `dj-prep-tool/src/lib/api.ts`

**Interfaces:**
- Produces `music_library_dir`, `beets_path`, and `beets_config_dir` settings.
- Produces `tagging`, `tagging_review`, and `ready_for_rekordbox` TrackState values.

- [ ] **Step 1: Extend the settings payload, public settings, frontend settings types, and save wrapper**

Use optional `musicLibraryDir`, `beetsPath`, and `beetsConfigDir` payload fields. Return paths as ordinary settings, never as credential flags.

- [ ] **Step 2: Add the three TrackState literals**

No runtime state whitelist exists in the current schema; the TypeScript union is the frontend contract. Do not add a second state registry.

- [ ] **Step 3: Run phase gates and commit**

Run: `npx tsc --noEmit`; `cargo check`

Commit: `feat: add tagging workflow configuration`

### Task 2: Implement the managed beets tagging command

**Files:**
- Create: `dj-prep-tool/py/beets_tag.py`
- Create: `dj-prep-tool/src-tauri/src/commands/tagging.rs`
- Modify: `dj-prep-tool/src-tauri/src/commands/mod.rs`
- Modify: `dj-prep-tool/src-tauri/src/lib.rs`
- Modify: `dj-prep-tool/src-tauri/src/quality.rs`

**Interfaces:**
- Produces `tag_track(app: AppHandle, track_id: i64) -> Result<TrackRow, String>`.
- `beets_tag.py` accepts the source path, target directory, artist, title, mix version, config directory, and beets path; it emits exactly one JSON object with `status`, `output_path`, and `notes`.

- [ ] **Step 1: Write failing helper tests for filename formatting and unsafe names**

```python
def test_filename_preserves_mix_version():
    assert output_name("Artist", "Title", "Extended Mix", ".flac") == "Artist - Title (Extended Mix).flac"

def test_filename_rejects_windows_path_separator():
    assert output_name("Artist/Other", "Title", None, ".flac") is None
```

- [ ] **Step 2: Run the helper tests and confirm failure**

Run: `python -m unittest dj-prep-tool/py/beets_tag.py`

- [ ] **Step 3: Implement the helper with a managed config and explicit outcomes**

Create the config directory if absent, keep the beets library database there, and use beets' strong recommendation behavior with weak matches reported as `review`. Never move the file until beets reports an accepted match and the resulting target filename is safe and non-colliding.

- [ ] **Step 4: Write failing Rust tests for state mapping**

```rust
#[test]
fn review_result_maps_to_tagging_review() {
    assert_eq!(state_for_tag_result("review"), "tagging_review");
}
```

- [ ] **Step 5: Implement `tag_track`, register it, and make successful quality checks enter `ready_for_conversion`**

Persist the successful destination in `archive_path`; set `ready_for_rekordbox` only for `tagged`, and set `tagging_review` with a non-secret error/note for `review` or `failed`.

- [ ] **Step 6: Run focused tests, phase gates, and commit**

Run: `python -m unittest dj-prep-tool/py/beets_tag.py`; `cargo test`; `npx tsc --noEmit`; `cargo check`

Commit: `feat: add managed beets tagging`

### Task 3: Finish the download-to-Rekordbox UI

**Files:**
- Modify: `dj-prep-tool/src/views/DownloadView.tsx`
- Modify: `dj-prep-tool/src/views/SetupView.tsx`
- Modify: `dj-prep-tool/src/lib/api.ts`
- Modify: `dj-prep-tool/src/lib/types.ts`
- Modify: `dj-prep-tool/src-tauri/src/commands/tagging.rs`

**Interfaces:**
- Consumes `tagTrack(trackId)` and `markRekordboxImported(trackId)`.
- Produces user-visible transitions from quality passed to tagging, tagging review, ready for Rekordbox, and `dj_ready`.

- [ ] **Step 1: Add setup fields and validation**

Require an existing writable music-library directory before enabling automatic tagging. Display no executable arguments, subprocess output, or credentials.

- [ ] **Step 2: Add per-track actions**

Offer `Tag automatically` only for `ready_for_conversion`; `Open in Picard` for `tagging_review`; and `Open music folder` plus `Mark imported` for `ready_for_rekordbox`.

- [ ] **Step 3: Perform the manual state walkthrough, verify, and commit**

Walk through each card state: `ready_for_conversion` shows Tag automatically, `tagging_review` shows Open in Picard, and `ready_for_rekordbox` shows Open music folder and Mark imported. The project has no React test runner; do not add one solely for these rendering branches.

Run: `npx tsc --noEmit`; `cargo check`

Commit: `feat: complete tagging handoff`

### Task 4: Import selected cosine recommendations safely

**Files:**
- Modify: `dj-prep-tool/src-tauri/src/import.rs`
- Modify: `dj-prep-tool/src-tauri/src/commands/import.rs`
- Modify: `dj-prep-tool/src-tauri/src/lib.rs`
- Modify: `dj-prep-tool/src/lib/api.ts`
- Modify: `dj-prep-tool/src/views/ReviewView.tsx`

**Interfaces:**
- Produces `import_similar_tracks(app, tracks: Vec<SimilarTrackDraft>) -> ImportSelectionResult`.
- `ImportSelectionResult` contains `added: Vec<TrackRow>` and `skipped: Vec<SimilarTrackDraft>`.

- [ ] **Step 1: Write a failing Rust test for case-insensitive project duplicate detection**

```rust
#[test]
fn selected_similar_track_skips_existing_artist_and_title() {
    let result = import_selected(&conn, &[draft("surgeon", "magneze")]).unwrap();
    assert_eq!(result.added.len(), 0);
    assert_eq!(result.skipped.len(), 1);
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cargo test selected_similar_track_skips_existing_artist_and_title`

- [ ] **Step 3: Implement one transactional backend import command**

Normalize artist and title with trim plus Unicode-safe case folding used consistently for lookup. Insert non-duplicates as `requested`; return skipped input rows without treating them as errors.

- [ ] **Step 4: Add selected-row UI and summary**

Keep selection local to the Similar panel. Disable the submit action when none are selected, clear selection after success, refresh the Review list, and show added/skipped counts.

- [ ] **Step 5: Verify and commit**

Run: `cargo test selected_similar_track_skips_existing_artist_and_title`; `npx tsc --noEmit`; `cargo check`

Commit: `feat: import selected similar tracks`

### Task 5: Add safe, per-view batch operations

**Files:**
- Modify: `dj-prep-tool/src-tauri/src/commands/download.rs`
- Modify: `dj-prep-tool/src-tauri/src/lib.rs`
- Modify: `dj-prep-tool/src/lib/api.ts`
- Modify: `dj-prep-tool/src/views/ReviewView.tsx`
- Modify: `dj-prep-tool/src/views/DownloadView.tsx`

**Interfaces:**
- Produces a nonblocking `check_download(app, track_id) -> Result<Option<String>, String>`.
- Frontend batches call existing single-track commands sequentially and collect `BatchResult { succeeded, failed }` in view state only.

- [ ] **Step 1: Write a failing Rust test for the nonblocking download check**

```rust
#[test]
fn missing_expected_file_returns_none_without_waiting() {
    assert_eq!(find_in_dir(tempdir.path(), "missing.flac"), None);
}
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `cargo test missing_expected_file_returns_none_without_waiting`

- [ ] **Step 3: Implement the single-pass check and retain `poll_download` for explicit single-track waiting**

The batch path must never call the ten-minute poll command. It checks the configured inbox once and transitions only files found to `downloaded`.

- [ ] **Step 4: Add checkboxes and sequential batch runners**

Review supports selected search and selected approved-download starts. Downloads supports selected quick status checks, quality checks, and tagging. Reset selection after refresh and leave each individual error intact.

- [ ] **Step 5: Verify and commit**

Run: `cargo test`; `npx tsc --noEmit`; `cargo check`

Commit: `feat: add workflow batch actions`

## Self-review

- Tagging, managed configuration, review fallback, file naming, direct Rekordbox use, and manual confirmation are covered by Tasks 1–3.
- Selected cosine import and backend duplicate protection are covered by Task 4.
- Per-view selection, sequential work, per-track failures, and nonblocking batch download checks are covered by Task 5.
- No credential is added to a public API, logged, or stored in a tracked file.
