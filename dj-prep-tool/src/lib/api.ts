import { invoke } from "@tauri-apps/api/core";
import type {
  PublicSettings,
  QualityResult,
  RankedCandidate,
  RekordboxPreview,
  SimilarTrack,
  SetupCheck,
  TrackRow,
  LogEntry,
} from "./types";

export interface SaveSettingsPayload {
  sockseekPath?: string;
  sockseekDaemonUrl?: string;
  prepInboxDir?: string;
  beetsPath?: string;
  musicLibraryDir?: string;
  beetsConfigDir?: string;
  ffmpegPath?: string;
  rekordboxImportDir?: string;
  rekordboxXmlPath?: string;
  pythonPath?: string;
  ytCookiesFile?: string;
  sockseekUsername?: string;
  sockseekPassword?: string;
  spotifyClientId?: string;
  spotifyClientSecret?: string;
  cosineApiKey?: string;
  telegramApiId?: string;
  telegramApiHash?: string;
  telegramSessionPath?: string;
  pathMapFrom?: string;
  pathMapTo?: string;
  beetsUrl?: string;
  setupComplete?: boolean;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function call<T>(name: string, payload?: Record<string, unknown>) {
  if (isTauri) {
    return invoke<T>(name, payload).catch((error) => {
      throw new Error(`${name} failed: ${String(error)}`);
    });
  }
  return fetch(`/api/invoke/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${name} failed: ${body.error ?? `request returned ${response.status}`}`);
    return body.result as T;
  });
}

export const api = {
  getSettings: () => call<PublicSettings>("get_settings"),

  saveSettings: (payload: SaveSettingsPayload) =>
    call<void>("save_settings", { payload }),

  checkRekordbox: (xmlPath: string) =>
    call<RekordboxPreview>("check_rekordbox", { xmlPath }),

  importRekordboxXml: (content: string) =>
    call<string>("import_rekordbox_xml", { content }),

  importRekordboxPlaylist: (tracks: Array<{ artist: string; title: string; mixVersion?: string | null; location?: string | null }>) =>
    call<TrackRow[]>("import_rekordbox_playlist", { tracks }),

  importText: (text: string) => call<TrackRow[]>("import_text", { text }),

  importCsv: (content: string) =>
    call<TrackRow[]>("import_csv", { content }),

  importYoutube: (url: string) =>
    call<TrackRow[]>("import_youtube", { url }),

  telegramLoginStart: (phone: string) =>
    call<string>("telegram_login_start", { phone }),

  telegramLoginCode: (code: string, password?: string) =>
    call<string>("telegram_login_code", { code, password: password || null }),

  telegramCheck: () => call<string>("telegram_check"),

  telegramFetchLinks: (channelId: string, limit: number) =>
    call<Array<{ url: string; messageUrl: string }>>("telegram_fetch_links", { channelId, limit }),

  importTelegramLink: (url: string, messageUrl: string, importTag: string) =>
    call<TrackRow[]>("import_telegram_link", { url, messageUrl, importTag }),

  importTelegram: (channelId: string, limit: number) =>
    call<{ tracks: TrackRow[]; skipped: string[] }>("import_telegram", { channelId, limit }),

  listTracks: (state?: string) =>
    call<TrackRow[]>("list_tracks", { state: state ?? null }),

  listActivity: (limit = 30) =>
    call<Array<{ id: number; trackId: number; artist: string; title: string; fromState: string | null; toState: string; createdAt: string }>>("list_activity", { limit }),

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
    call<TrackRow>("poll_download", { trackId }),

  checkDownloadProgress: (trackId: number) =>
    call<{ bytesOnDisk: number | null; bytesTotal: number | null }>("check_download_progress", { trackId }),

  cancelDownload: (trackId: number) =>
    call<void>("cancel_download", { trackId }),

  convertTrack: (trackId: number) =>
    call<TrackRow>("convert_track", { trackId }),

  tagTrack: (trackId: number) =>
    call<TrackRow>("tag_track", { trackId }),

  finishRekordbox: (trackId: number) =>
    call<TrackRow>("finish_rekordbox", { trackId }),

  openFolder: (path: string) =>
    call<void>("open_folder", { path }),

  runQualityCheck: (trackId: number) =>
    call<QualityResult>("run_quality_check", { trackId }),

  getSimilarTracks: (trackId: number) =>
    call<SimilarTrack[]>("get_similar_tracks", { trackId }),

  getSimilarTracksForQuery: (artist: string, title: string) =>
    call<SimilarTrack[]>("get_similar_tracks_for_query", { artist, title }),

  getYoutubeAuthUrl: () =>
    call<{ authorized: boolean; url: string | null }>("get_youtube_auth_url"),

  createYoutubePlaylist: (videoIds: string[], title: string, skipped: string[] = []) =>
    call<{ playlistUrl: string; added: number; skipped: string[] }>("create_youtube_playlist", { videoIds, title, skipped }),

  launchSockseek: () => call<void>("launch_sockseek"),
  restartSockseek: () => call<void>("restart_sockseek"),
  checkDaemon: () => call<boolean>("check_daemon"),
  validateSetup: () => call<SetupCheck[]>("validate_setup"),
  backupDatabase: () => call<string>("backup_database"),
  listBackups: () => call<string[]>("list_backups"),
  restoreDatabase: (backupName: string) => call<void>("restore_database", { backupName }),
  getLogs: () => call<LogEntry[]>("get_logs"),
};
