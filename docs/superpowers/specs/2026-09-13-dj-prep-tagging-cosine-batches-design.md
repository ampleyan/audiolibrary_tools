# DJ prep tagging, cosine import, and batch operations

## Goal

Complete the DJ preparation loop after a download, turn cosine.club recommendations into normal import candidates, and make repeated actions practical without hiding individual failures.

## Tagging and Rekordbox handoff

The app owns a dedicated beets configuration and database. It does not reuse or alter a general-purpose beets library.

After a quality check succeeds, the track is eligible for tagging. A strong beets recommendation tags the file, renames it, and moves it to the configured music-library directory. The initial user setting is `E:\MUSIC\RECENT`.

Output names follow these rules:

```
Artist - Title.ext
Artist - Title (Mix Version).ext
```

The app preserves the imported track's mix version when it exists. A weak, ambiguous, or failed beets match enters a tagging-review state and offers Picard as an exception workflow.

Rekordbox reads files directly from the music-library directory. The app never creates a duplicate Rekordbox copy. Once the user has manually imported a tagged file into Rekordbox, they mark it imported in the app, which transitions it to `dj_ready`.

The state progression is:

```
downloaded → ready_for_conversion → tagging → ready_for_rekordbox → dj_ready
                                      ↘ tagging_review
```

Existing `picard_pending` data remains readable and is surfaced as tagging review during the compatibility transition.

## Cosine recommendation import

Each recommendation in the Similar panel can be selected. A single `Add selected to import` action submits the selected artist/title pairs to the backend.

The backend owns duplicate detection against existing project tracks and returns the tracks it added plus the rows it skipped. Added tracks enter the ordinary `requested` state and use the existing review, search, approval, and download flow.

## Batch operations

Selection belongs to the current view only and resets on refresh. Batch actions run sequentially so Sockseek and local tooling are not overloaded, while every track retains its own state and error.

Review supports batch search and starting downloads for selected approved tracks. Downloads supports checking selected download status, quality checking completed files, and tagging selected quality-passed files.

The current ten-minute `poll_download` command is unsuitable for a batch. Batch refresh uses a new quick, single-pass status/file-presence check instead. The interface reports a summary such as added, skipped, succeeded, failed, and needs-review counts, while individual errors remain on their cards.

## Safety and configuration

- The music-library directory, beets executable or Python environment, and beets config/database location are user settings; no path is hard-coded into application logic.
- The managed beets configuration contains no credentials.
- File moves occur only after a successful quality check and accepted strong match.
- Rekordbox files are never overwritten or duplicated by the app.
- Ambiguous metadata is never applied automatically.

## Delivery phases

1. Add compatible state/configuration support and tests for transitions and filename decisions.
2. Add the managed beets integration and the per-track tagging/review commands.
3. Wire the Download view through tagging, folder reveal, and manual Rekordbox confirmation.
4. Add selected cosine imports with backend duplicate protection.
5. Add per-view selection and the safe batch actions, including the nonblocking download-status refresh.

Each phase changes at most five files, is verified independently, and waits for approval before the next phase.
