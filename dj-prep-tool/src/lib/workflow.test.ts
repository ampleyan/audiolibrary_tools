import { describe, expect, it } from "vitest";
import type { TrackRow, TrackState, WorkflowMetadata } from "./types";
import { getNextAction, getWorkflowMeta, isActionable, isWorkflowBlocked } from "./workflow";

function track(state: TrackState, overrides: Partial<TrackRow> = {}): TrackRow {
  return {
    id: 1,
    artist: "Artist",
    title: "Title",
    mix_version: null,
    source_url: null,
    import_tag: null,
    state,
    candidate_json: null,
    selected_username: null,
    selected_filename: null,
    downloaded_path: null,
    quality_result: null,
    quality_notes: null,
    archive_path: null,
    dj_path: null,
    search_job_id: null,
    download_job_id: null,
    error: null,
    created_at: "2026-09-15T10:00:00Z",
    updated_at: "2026-09-15T10:00:00Z",
    ...overrides,
  };
}

const stateMappings: Array<[TrackState, WorkflowMetadata]> = [
  ["requested", { bucket: "inbox", stage: "find", statusLabel: "Awaiting search", nextAction: { id: "search", label: "Search for a file" }, actionable: true }],
  ["needs_review", { bucket: "needs_attention", stage: "find", statusLabel: "Track details needed", nextAction: { id: "edit_details", label: "Edit track details" }, actionable: true }],
  ["not_found", { bucket: "needs_attention", stage: "find", statusLabel: "No file found", nextAction: { id: "loose_search", label: "Loose search" }, actionable: true }],
  ["matched", { bucket: "needs_attention", stage: "match", statusLabel: "Candidates found", nextAction: { id: "approve", label: "Approve a candidate" }, actionable: true }],
  ["approved", { bucket: "needs_attention", stage: "download", statusLabel: "Approved", nextAction: { id: "download", label: "Start download" }, actionable: true }],
  ["downloading", { bucket: "running", stage: "download", statusLabel: "Downloading", nextAction: { id: "monitor_download", label: "Monitor download" }, actionable: false }],
  ["downloaded", { bucket: "needs_attention", stage: "quality", statusLabel: "Downloaded", nextAction: { id: "quality_check", label: "Run quality check" }, actionable: true }],
  ["conversion_pending", { bucket: "needs_attention", stage: "convert", statusLabel: "Conversion needed", nextAction: { id: "convert", label: "Convert to MP3" }, actionable: true }],
  ["converted", { bucket: "needs_attention", stage: "quality", statusLabel: "Converted", nextAction: { id: "quality_check", label: "Run quality check" }, actionable: true }],
  ["quality_failed", { bucket: "needs_attention", stage: "quality", statusLabel: "Quality check failed", nextAction: { id: "retry_quality", label: "Retry quality check" }, actionable: true }],
  ["ready_for_conversion", { bucket: "needs_attention", stage: "tag", statusLabel: "Ready for tagging", nextAction: { id: "tag", label: "Run Beets tagging" }, actionable: true }],
  ["picard_pending", { bucket: "needs_attention", stage: "tag", statusLabel: "Picard review needed", nextAction: { id: "review_tagging", label: "Finish tagging" }, actionable: true }],
  ["tagging_review", { bucket: "needs_attention", stage: "tag", statusLabel: "Tagging review needed", nextAction: { id: "review_tagging", label: "Finish tagging" }, actionable: true }],
  ["ready_for_rekordbox", { bucket: "needs_attention", stage: "rekordbox", statusLabel: "Ready for Rekordbox", nextAction: { id: "send_to_rekordbox", label: "Send to Rekordbox" }, actionable: true }],
  ["rekordbox_pending", { bucket: "needs_attention", stage: "rekordbox", statusLabel: "Rekordbox handoff pending", nextAction: { id: "send_to_rekordbox", label: "Send to Rekordbox" }, actionable: true }],
  ["dj_ready", { bucket: "ready_to_dj", stage: "done", statusLabel: "DJ ready", nextAction: { id: "reveal", label: "Reveal DJ-ready file" }, actionable: false }],
  ["failed", { bucket: "needs_attention", stage: "download", statusLabel: "Failed", nextAction: { id: "review_error", label: "Review error" }, actionable: true }],
];

describe("workflow metadata", () => {
  it.each(stateMappings)("maps %s to its workbench metadata", (state, expected) => {
    expect(getWorkflowMeta(track(state))).toEqual(expected);
  });

  it("treats a requested track with a completed search as needing a loose search", () => {
    const searchedTrack = track("requested", { search_job_id: "search-1" });

    expect(getWorkflowMeta(searchedTrack)).toEqual({
      bucket: "needs_attention",
      stage: "find",
      statusLabel: "No results yet",
      nextAction: { id: "loose_search", label: "Loose search" },
      actionable: true,
    });
  });

  it("uses explicit retry wording after a no-result search", () => {
    const searchedTrack = track("requested", { search_job_id: "search-1" });

    expect(getNextAction(searchedTrack).label).toBe("Loose search");
  });

  it.each([
    track("requested", { search_job_id: "search-1", error: "No results found" }),
    track("not_found"),
    track("needs_review"),
    track("quality_failed"),
    track("tagging_review"),
    track("picard_pending"),
    track("failed"),
    track("approved", { error: "Download needs attention" }),
  ])("groups $state tracks that need remediation as blocked", (row) => {
    expect(isWorkflowBlocked(row)).toBe(true);
  });

  it.each([
    track("requested"),
    track("matched"),
    track("approved"),
    track("downloading"),
    track("dj_ready"),
  ])("does not group an unblocked $state track as blocked", (row) => {
    expect(isWorkflowBlocked(row)).toBe(false);
  });

  it.each(stateMappings)("derives the %s action and actionable flag from shared metadata", (state, expected) => {
    const row = track(state);

    expect(getNextAction(row)).toEqual(expected.nextAction);
    expect(isActionable(row)).toBe(expected.actionable);
  });
});
