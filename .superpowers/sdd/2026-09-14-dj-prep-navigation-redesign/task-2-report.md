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
