# DJ Prep Tool

The product helps DJs turn track sources into a trustworthy, ready-to-use music library while keeping music discovery as a separate activity.

## Product language

**Pipeline**:
The primary path from imported track request to a reviewed, downloaded, and DJ-ready file.
_Avoid_: Workflow, process

**Discovery**:
A separate activity for browsing the Rekordbox library, finding related tracks, and choosing whether to add them to the Pipeline or export them elsewhere.
_Avoid_: Similar search, recommendations

**Rekordbox library**:
The read-only collection of tracks parsed from the configured Rekordbox XML export.

**Library gap**:
A Rekordbox library track that is not represented by a matching Pipeline track.

**Match status**:
The non-destructive relationship between a Rekordbox library track and one or more Pipeline tracks.

**Inbox**:
The Pipeline group containing newly imported tracks that have not started review.
_Avoid_: New, Unprocessed

**Needs attention**:
The Pipeline group containing tracks blocked by missing data, failed searches, or quality problems.
_Avoid_: Errors, Failed

**Ready**:
The Pipeline group containing tracks that completed preparation and can be used by the DJ.
_Avoid_: Complete, Done
