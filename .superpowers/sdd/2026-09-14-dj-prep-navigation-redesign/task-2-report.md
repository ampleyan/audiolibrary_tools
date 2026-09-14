# Task 2 Report: Make Library the preparation queue

## Delivered

- Preserved Task 1's `library` route and existing technical route values.
- Made Library describe itself as the preparation queue and retained the existing TrackRow-backed queue groupings and health summary.
- Kept one `Add tracks` entry action in Library. It navigates to the existing `ImportView`; no import state or API calls were duplicated in Library.
- Added a `Back to Library` action in `ImportView` so the import route returns directly to the preparation queue.
- Replaced Library card drawers with exactly one recommended next-action button per track. The existing state-to-action labels are retained, and the action routes review-stage tracks to `review` and preparation-stage tracks to `downloads`.
- Left the Overview route's existing drawer behavior unchanged for Task 3.

## Verification

- `npx.cmd tsc --noEmit` passed.
- `npx.cmd vite build` passed.
- Started `npx.cmd tauri dev`; the frontend and Rust desktop app compiled and the application process launched. Rust emitted two pre-existing deprecation warnings in tagging and YouTube commands.
- Manually traced the empty route (`Library` → `Add tracks` → `ImportView` → `Back to Library`) and populated route (`TrackRow` grouping → one state-derived action → `Review` or `Download`) in the rendered component wiring.

## Scope and concerns

- Only `App.tsx`, `PipelineView.tsx`, `ImportView.tsx`, and this report are included.
- No credentials, database files, or pre-existing untracked artifacts are staged.
- The native-app accessibility surface was not exposed to the available UI automation session after launch, so the manual route inspection was source-wiring based rather than a captured native UI interaction.

## Fix Round 1

### Findings addressed

- Library Continue now routes the first attention track to Review or Download based on its existing state, rather than selecting a suppressed drawer.
- A not-found row now says `Search again`, resets its state to `requested`, and opens Review, which loads requested tracks.
- A DJ-ready row now says `Open DJ-ready file` and directly opens its persisted `dj_path`. The backend writes `dj_path` when it moves a track to `dj_ready`.

### Manual route evidence

- Empty state: `PipelineView` renders `No tracks in your Library yet. Add tracks to get started.` when `api.listTracks()` returns an empty array; the sole `Add tracks` action calls `onNavigate("import")`, and ImportView's `Back to Library` action calls `onNavigate("library")`.
- Populated state: tracks are grouped from the single `api.listTracks()` result. Continue routes the first attention track through `workViewFor`: `requested`, `needs_review`, and `matched` go to Review; download-preparation states go to Download.
- Not-found: the Library action invokes `api.updateTrackState(track.id, "requested")` before navigating to Review; Review loads `requested`, `needs_review`, and `matched` tracks.
- DJ-ready: the Library action invokes `api.openFolder(track.dj_path)`. `src-tauri/src/commands/download.rs` persists `dj_path` in the same update that sets `state = 'dj_ready'`.
- Native UI evidence: `npx.cmd tauri dev` completed the desktop build and launched `target\\debug\\dj-prep.exe`. The available UI automation inventory exposed no native apps, so it could not capture the desktop route interactions.
- Commands run for this fix: `npx.cmd tsc --noEmit` (exit 0), `npx.cmd vite build` (exit 0), and `npx.cmd tauri dev` (compiled, then launched `target\\debug\\dj-prep.exe`).
- UI automation evidence: `await cua.getState({ disableDiffing: true })` returned `apps: []` after the app launched. No native Library surface was therefore available to click through; the empty and populated route assertions above are the exact component and API paths inspected.
