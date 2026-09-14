# Task 4 report: Discovery handoff

## Changed files

- `dj-prep-tool/src/views/ReviewView.tsx`
  - Reused the existing `api.importText` path for selected similar tracks.
  - Made `Add to Library` the selected-track primary action and reports the returned added-track count.
  - Keeps text playlist download and YouTube playlist creation as secondary actions; the latter now uses the same secondary visual treatment.
  - Adds an optional `onOpenLibrary` callback so the shared panel does not own navigation or duplicate Discovery state.
- `dj-prep-tool/src/views/DiscoveryView.tsx`
  - Accepts the navigation callback, passes it to `SimilarPanel`, and updates the empty-state destination name to Library.
- `dj-prep-tool/src/App.tsx`
  - Supplies the existing app-level navigation function to Discovery, allowing the success message's `View Library` action to return to the Library tab.

## Reasoning

The existing SimilarPanel already holds the selection, multi-source source selector, similarity filters, preview, text export, YouTube export, and import operation. Extending that panel keeps those controls intact and avoids copying selected-track state into Discovery. The import result supplies the success count; Discovery contributes only the destination navigation.

## Verification

- Completed focused source inspection of Discovery, App, SimilarPanel, existing API wrappers, types, and related import/navigation flows.
- Ran `git diff --check`; it completed without whitespace errors.
- Did not run `npx.cmd tsc --noEmit`, `npx.cmd vite build`, or `cargo.exe test -j 1`, and did not perform an application-level manual test. These checks were explicitly skipped at the user's request.
