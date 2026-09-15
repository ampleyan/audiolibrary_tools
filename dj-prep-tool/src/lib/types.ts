export type TrackState =
  | "requested"
  | "needs_review"
  | "not_found"
  | "matched"
  | "approved"
  | "downloading"
  | "downloaded"
  | "conversion_pending"
  | "converted"
  | "quality_failed"
  | "picard_pending"
  | "ready_for_conversion"
  | "tagging_review"
  | "ready_for_rekordbox"
  | "dj_ready"
  | "rekordbox_pending"
  | "failed";

export type WorkflowBucket = "inbox" | "needs_attention" | "running" | "ready_to_dj";

export type WorkflowStage = "find" | "match" | "download" | "convert" | "quality" | "tag" | "rekordbox" | "done";

export type TrackActionId =
  | "search"
  | "edit_details"
  | "loose_search"
  | "approve"
  | "download"
  | "monitor_download"
  | "convert"
  | "quality_check"
  | "retry_quality"
  | "tag"
  | "review_tagging"
  | "send_to_rekordbox"
  | "reveal"
  | "review_error";

export interface TrackAction {
  id: TrackActionId;
  label: string;
}

export interface WorkflowMetadata {
  bucket: WorkflowBucket;
  stage: WorkflowStage;
  statusLabel: string;
  nextAction: TrackAction;
  actionable: boolean;
}

export interface TrackRow {
  id: number;
  artist: string;
  title: string;
  mix_version: string | null;
  source_url: string | null;
  import_tag: string | null;
  state: TrackState;
  candidate_json: string | null;
  selected_username: string | null;
  selected_filename: string | null;
  downloaded_path: string | null;
  quality_result: string | null;
  quality_notes: string | null;
  archive_path: string | null;
  dj_path: string | null;
  search_job_id: string | null;
  download_job_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicSettings {
  sockseekPath: string;
  sockseekDaemonUrl: string;
  prepInboxDir: string;
  beetsPath: string;
  musicLibraryDir: string;
  beetsConfigDir: string;
  ffmpegPath: string;
  rekordboxImportDir: string;
  rekordboxXmlPath: string;
  pythonPath: string;
  ytCookiesFile: string;
  setupComplete: boolean;
  hasSockseekCredentials: boolean;
  hasSpotifyCredentials: boolean;
  hasCosineCredentials: boolean;
  hasTelegramCredentials: boolean;
  hasTelegramSession: boolean;
  pathMapFrom: string;
  pathMapTo: string;
  beetsUrl: string;
}

export interface SimilarTrack {
  artist: string;
  title: string;
  mixVersion: string | null;
  videoUrl: string | null;
  cosineId: string;
  score: number;
}

export interface RekordboxTrack {
  artist: string;
  title: string;
  mixVersion: string | null;
  location: string | null;
  inLibrary: boolean;
  album: string | null;
  genre: string | null;
  bpm: string | null;
  key: string | null;
  rating: string | null;
  playCount: string | null;
  dateAdded: string | null;
  playlists: string[];
}

export interface RekordboxPreview {
  tracksInXml: RekordboxTrack[];
}

export interface Candidate {
  username: string;
  filename: string;
  bitRate: number | null;
  sampleRate: number | null;
  length: number | null;
  extension: string;
  size: number | null;
}

export interface RankedCandidate {
  candidate: Candidate;
  score: number;
}

export interface QualityResult {
  isRealFlac: boolean | null;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  durationSecs: number | null;
  spectralCutoffHz: number | null;
  spectralPassed: boolean | null;
  notes: string;
}

export interface LogEntry {
  timestamp: string;
  message: string;
}

export interface SetupCheck {
  name: string;
  ok: boolean;
  detail: string;
}
