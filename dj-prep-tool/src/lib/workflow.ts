import type { TrackAction, TrackRow, TrackState, WorkflowMetadata } from "./types";

const WORKFLOW_BY_STATE: Record<TrackState, WorkflowMetadata> = {
  requested: {
    bucket: "inbox",
    stage: "find",
    statusLabel: "Awaiting search",
    nextAction: { id: "search", label: "Search for a file" },
    actionable: true,
  },
  needs_review: {
    bucket: "needs_attention",
    stage: "find",
    statusLabel: "Track details needed",
    nextAction: { id: "edit_details", label: "Edit track details" },
    actionable: true,
  },
  not_found: {
    bucket: "needs_attention",
    stage: "find",
    statusLabel: "No file found",
    nextAction: { id: "loose_search", label: "Loose search" },
    actionable: true,
  },
  matched: {
    bucket: "needs_attention",
    stage: "match",
    statusLabel: "Candidates found",
    nextAction: { id: "approve", label: "Approve a candidate" },
    actionable: true,
  },
  approved: {
    bucket: "needs_attention",
    stage: "download",
    statusLabel: "Approved",
    nextAction: { id: "download", label: "Start download" },
    actionable: true,
  },
  downloading: {
    bucket: "running",
    stage: "download",
    statusLabel: "Downloading",
    nextAction: { id: "monitor_download", label: "Monitor download" },
    actionable: true,
  },
  downloaded: {
    bucket: "needs_attention",
    stage: "quality",
    statusLabel: "Downloaded",
    nextAction: { id: "quality_check", label: "Run quality check" },
    actionable: true,
  },
  conversion_pending: {
    bucket: "needs_attention",
    stage: "convert",
    statusLabel: "Conversion needed",
    nextAction: { id: "convert", label: "Convert to MP3" },
    actionable: true,
  },
  converted: {
    bucket: "needs_attention",
    stage: "quality",
    statusLabel: "Converted",
    nextAction: { id: "quality_check", label: "Run quality check" },
    actionable: true,
  },
  quality_failed: {
    bucket: "needs_attention",
    stage: "quality",
    statusLabel: "Quality check failed",
    nextAction: { id: "retry_quality", label: "Retry quality check" },
    actionable: true,
  },
  ready_for_conversion: {
    bucket: "needs_attention",
    stage: "tag",
    statusLabel: "Ready for tagging",
    nextAction: { id: "tag", label: "Run Beets tagging" },
    actionable: true,
  },
  picard_pending: {
    bucket: "needs_attention",
    stage: "tag",
    statusLabel: "Picard review needed",
    nextAction: { id: "review_tagging", label: "Finish tagging" },
    actionable: true,
  },
  tagging_review: {
    bucket: "needs_attention",
    stage: "tag",
    statusLabel: "Tagging review needed",
    nextAction: { id: "review_tagging", label: "Finish tagging" },
    actionable: true,
  },
  ready_for_rekordbox: {
    bucket: "needs_attention",
    stage: "rekordbox",
    statusLabel: "Ready for Rekordbox",
    nextAction: { id: "send_to_rekordbox", label: "Send to Rekordbox" },
    actionable: true,
  },
  rekordbox_pending: {
    bucket: "needs_attention",
    stage: "rekordbox",
    statusLabel: "Rekordbox handoff pending",
    nextAction: { id: "send_to_rekordbox", label: "Send to Rekordbox" },
    actionable: true,
  },
  dj_ready: {
    bucket: "ready_to_dj",
    stage: "done",
    statusLabel: "DJ ready",
    nextAction: { id: "reveal", label: "Reveal DJ-ready file" },
    actionable: false,
  },
  failed: {
    bucket: "needs_attention",
    stage: "download",
    statusLabel: "Failed",
    nextAction: { id: "review_error", label: "Review error" },
    actionable: true,
  },
};

const BLOCKED_STATES = new Set<TrackState>([
  "needs_review",
  "not_found",
  "quality_failed",
  "tagging_review",
  "picard_pending",
  "failed",
]);

const SEARCHED_WITHOUT_RESULTS: WorkflowMetadata = {
  bucket: "needs_attention",
  stage: "find",
  statusLabel: "No results yet",
  nextAction: { id: "loose_search", label: "Loose search" },
  actionable: true,
};

export function getWorkflowMeta(track: TrackRow): WorkflowMetadata {
  if (track.state === "requested" && track.search_job_id) return SEARCHED_WITHOUT_RESULTS;
  return WORKFLOW_BY_STATE[track.state];
}

export function getNextAction(track: TrackRow): TrackAction {
  return getWorkflowMeta(track).nextAction;
}

export function isActionable(track: TrackRow): boolean {
  return getWorkflowMeta(track).actionable;
}

export function isWorkflowBlocked(track: TrackRow): boolean {
  return BLOCKED_STATES.has(track.state)
    || Boolean(track.error)
    || (track.state === "requested" && Boolean(track.search_job_id));
}
