# DJ Prep Tool flow and interface redesign

## Problem Statement

The current interface exposes implementation stages as separate activities and places Discovery inside Review. Users must decide where to go next, interpret technical states, and manage several competing actions in one screen. This makes the path from imported tracks to DJ-ready files feel clunky, especially when processing a batch.

## Solution

Make the Pipeline the primary workspace. New imports enter the Pipeline Inbox and are grouped into Inbox, Needs attention, In progress, and Ready. Each track presents one recommended next action, and a Continue action opens the next track needing attention. Track details open in a drawer so the user keeps queue context.

Move related-track exploration into a separate Discovery workspace. Discovery can search from one or more Pipeline tracks, apply similarity filters, preview results, and send selected tracks to the Pipeline or export them as a YouTube playlist or text playlist. Add to Pipeline is the primary action.

Use a responsive dark studio visual system: compact and information-dense on desktop, more spacious on smaller screens, with restrained amber and blue signals for state and action. Use plain user-facing language rather than technical state names.

## User Stories

1. As a DJ, I want newly imported tracks to appear in a Pipeline Inbox, so that I know where unprocessed work begins.
2. As a DJ, I want to see how many tracks are in each Pipeline group, so that I can understand the state of a batch at a glance.
3. As a DJ, I want the Pipeline to group tracks by actionable status, so that I do not need to understand internal state names.
4. As a DJ, I want a Continue action to open the next track needing attention, so that I can process a batch without manually finding the next item.
5. As a DJ, I want each track to show one recommended next action, so that the interface answers what I should do now.
6. As a DJ, I want to inspect a track without leaving the Pipeline, so that I do not lose my place in a batch.
7. As a DJ, I want to edit artist, title, and mix information before searching, so that poor imports can be corrected at the source.
8. As a DJ, I want the best candidate file highlighted, so that comparison is fast while approval remains deliberate.
9. As a DJ, I want to approve a candidate per track, so that automated ranking never silently chooses my library files.
10. As a DJ, I want to search multiple tracks in one action, so that repetitive work is reduced.
11. As a DJ, I want to start eligible downloads in a batch, so that I can prepare a larger set efficiently.
12. As a DJ, I want to run eligible quality checks in a batch, so that verification does not require opening every track.
13. As a DJ, I want blocked tracks to remain visible in Needs attention, so that failures do not disappear from my work queue.
14. As a DJ, I want each blocked track to explain the problem in plain language, so that I know what needs fixing.
15. As a DJ, I want a recovery action next to a blocked track, so that I can resolve it without searching through menus.
16. As a DJ, I want one Add tracks entry point, so that URL, pasted text, and CSV imports feel like one operation.
17. As a DJ, I want the import form to show only fields relevant to the selected source type, so that importing stays simple.
18. As a DJ, I want successful actions to update the Pipeline immediately, so that progress is trustworthy without manual refresh.
19. As a DJ, I want a short confirmation after an action, so that I know whether the intended change happened.
20. As a DJ, I want Discovery separated from the Pipeline, so that finding music does not interrupt file preparation.
21. As a DJ, I want Discovery to use one or more Pipeline tracks as sources, so that I can explore from a single track or a group.
22. As a DJ, I want to tune maximum results and minimum similarity score, so that Discovery produces a manageable list.
23. As a DJ, I want duplicate recommendations removed, so that a multi-source search does not create repetitive results.
24. As a DJ, I want to preview a recommendation inline, so that I can evaluate it without opening another tool.
25. As a DJ, I want selected recommendations to be clearly distinguished from unselected results, so that batch actions are safe.
26. As a DJ, I want Add to Pipeline to be the primary Discovery action, so that promising tracks enter the main preparation path.
27. As a DJ, I want to create a YouTube playlist from selected recommendations, so that I can listen to or share a discovery set.
28. As a DJ, I want to export recommendations as a text playlist, so that I can use them in other tools.
29. As a DJ, I want unavailable or rejected YouTube videos reported without cancelling the playlist, so that one bad result does not lose the useful results.
30. As a DJ, I want the number of successfully added playlist items shown accurately, so that I know what the playlist contains.
31. As a DJ, I want the interface to remain usable on a tablet, so that I can check and manage preparation away from my main workstation.
32. As a DJ, I want desktop layouts to show many tracks without feeling cramped, so that batch preparation remains fast.
33. As a DJ, I want keyboard focus and visible action states, so that the interface is usable without relying only on a mouse.
34. As a DJ, I want the same primary concepts in the web and desktop editions, so that moving between platforms does not require relearning the tool.

## Implementation Decisions

- The top-level navigation is Pipeline, Discover, and Settings.
- Import is an entry action within Pipeline, not a top-level destination.
- Pipeline groups are Inbox, Needs attention, In progress, and Ready. Existing technical states remain backend concepts and map into these groups.
- Continue selects the next actionable track using a stable ordering and opens its detail drawer.
- A track row owns one recommended next action. Secondary actions remain available in the drawer or an overflow action area.
- The detail drawer preserves the Pipeline list and supports editing, candidate inspection, approval, download progress, and quality results.
- Search-all, batch download, and batch quality-check actions are allowed where tracks are eligible. Candidate approval remains an explicit per-track action.
- Discovery is a separate view that reads Pipeline tracks as sources and returns deduplicated recommendations.
- Discovery actions are ordered by user intent: Add to Pipeline, then YouTube playlist and text export.
- Similarity controls remain available in Discovery and apply to the visible recommendation set.
- YouTube playlist creation creates the playlist first, then attempts each item independently. HTTP rejection of one item marks that item skipped and does not abort the remaining inserts. Transport or authorization failures still fail the operation.
- User-facing copy uses Pipeline, Discovery, Inbox, Needs attention, In progress, Ready, and recommended action. Technical backend state names do not appear as primary labels.
- The visual system uses a dark studio base with amber and blue signals, compact desktop spacing, responsive drawer/list behavior, visible focus states, and reduced-motion-compatible transitions.
- The shared React view behavior is the primary UI seam consumed by both web and Tauri editions.

## Testing Decisions

- Test user-visible behavior at the shared view seam with the API layer mocked.
- Cover Pipeline grouping, Continue selection, recommended actions, drawer preservation, import entry behavior, and batch action eligibility.
- Cover Discovery source selection, filters, deduplication, selection, preview controls, and the three output actions.
- Cover YouTube playlist behavior with a mocked API response containing both successful and rejected item inserts; verify successful items continue and the result count and skipped count are accurate.
- Keep backend tests focused on their existing command/API contracts, including playlist insertion error handling.
- Run the frontend type check and production build as integration gates.
- Run Rust checks and Python compilation for backend changes.
- Prefer assertions on visible labels, enabled/disabled actions, state transitions, and returned results rather than implementation details or CSS values.

## Out of Scope

- Changing the Soulseek provider or download protocol.
- Automatic candidate approval.
- Automatic public YouTube playlists; playlists remain private by default.
- Full mobile feature parity.
- New tagging or Rekordbox automation.
- Replacing the existing similarity provider.
- Redesigning the underlying database schema unless a required Pipeline interaction cannot be represented by the current model.
- Broad visual redesign of unrelated legacy scripts.

## Further Notes

- The current YouTube insertion failure exposed the need for partial-success handling; this behavior is included so playlist creation remains useful when individual recommendation videos are unavailable or rejected.
- The redesign should be delivered in small vertical slices: first the Pipeline shell and grouping, then the track drawer and Continue flow, then Discovery extraction and output actions, followed by visual polish and responsive verification.
- No issue tracker configuration is currently available in the repository context, so ticket publication should wait until the tracker setup is provided.
