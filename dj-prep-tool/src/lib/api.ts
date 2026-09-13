import { invoke } from "@tauri-apps/api/core";
import type {
  PublicSettings,
  QualityResult,
  RankedCandidate,
  SimilarTrack,
  TrackRow,
  LogEntry,
} from "./types";

export interface SaveSettingsPayload {
  sockseekPath?: string;
  sockseekDaemonUrl?: string;
  prepInboxDir?: string;
  picardPath?: string;
  ffmpegPath?: string;
  rekordboxImportDir?: string;
  pythonPath?: string;
  ytCookiesFile?: string;
  sockseekUsername?: string;
  sockseekPassword?: string;
  spotifyClientId?: string;
  spotifyClientSecret?: string;
  cosineApiKey?: string;
  setupComplete?: boolean;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function call<T>(name: string, payload?: Record<string, unknown>) {
  if (isTauri) return invoke<T>(name, payload);
  return fetch(`/api/invoke/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  }).then(async (response) => {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `Request failed: ${response.status}`);
    return body.result as T;
  });
}

export const api = {
  getSettings: () => call<PublicSettings>("get_settings"),

  saveSettings: (payload: SaveSettingsPayload) =>
    call<void>("save_settings", { payload }),

  importText: (text: string) => call<TrackRow[]>("import_text", { text }),

  importCsv: (content: string) =>
    call<TrackRow[]>("import_csv", { content }),

  importYoutube: (url: string) =>
    call<TrackRow[]>("import_youtube", { url }),

  listTracks: (state?: string) =>
    call<TrackRow[]>("list_tracks", { state: state ?? null }),

  updateTrackState: (id: number, state: string) =>
    call<void>("update_track_state", { id, state }),

  deleteTrack: (id: number) => call<void>("delete_track", { id }),

  clearTracks: () => call<void>("clear_tracks"),

  updateTrack: (id: number, artist: string, title: string, mixVersion: string | null) =>
    call<TrackRow>("update_track", { id, artist, title, mixVersion }),

  searchTrack: (trackId: number) =>
    call<RankedCandidate[]>("search_track", { trackId }),

  searchTrackLoose: (trackId: number) =>
    call<RankedCandidate[]>("search_track_loose", { trackId }),

  approveCandidate: (trackId: number, username: string, filename: string) =>
    call<void>("approve_candidate", { trackId, username, filename }),

  startDownload: (trackId: number) =>
    call<void>("start_download", { trackId }),

  pollDownload: (trackId: number) =>
    call<string>("poll_download", { trackId }),

  checkDownloadProgress: (trackId: number) =>
    call<{ bytesOnDisk: number | null; bytesTotal: number | null }>("check_download_progress", { trackId }),

  tagTrack: (trackId: number) =>
    call<TrackRow>("tag_track", { trackId }),

  openFolder: (path: string) =>
    call<void>("open_folder", { path }),

  runQualityCheck: (trackId: number) =>
    call<QualityResult>("run_quality_check", { trackId }),

  getSimilarTracks: (trackId: number) =>
    call<SimilarTrack[]>("get_similar_tracks", { trackId }),

  getYoutubeAuthUrl: () =>
    call<{ authorized: boolean; url: string | null }>("get_youtube_auth_url"),

  createYoutubePlaylist: (videoIds: string[], title: string, skipped: string[] = []) =>
    call<{ playlistUrl: string; added: number; skipped: string[] }>("create_youtube_playlist", { videoIds, title, skipped }),

  launchSockseek: () => call<void>("launch_sockseek"),
  checkDaemon: () => call<boolean>("check_daemon"),
  getLogs: () => call<LogEntry[]>("get_logs"),
};
