import { invoke } from "@tauri-apps/api/core";
import type {
  PublicSettings,
  QualityResult,
  RankedCandidate,
  RekordboxPreview,
  SimilarTrack,
  CosineFilters,
  DownloadStatus,
  SetupCheck,
  ImportPreviewRow,
  TrackRow,
  LogEntry,
  Playlist,
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
export const WORKBENCH_DATA_CHANGED_EVENT = "dj-prep:data-changed";
const MUTATING_COMMANDS = new Set([
  "save_settings", "import_text", "import_csv", "import_youtube", "import_telegram", "import_telegram_link", "import_rekordbox_playlist",
  "update_track", "update_track_state", "delete_track", "clear_tracks", "approve_candidate", "start_download", "start_download_files", "cancel_download", "poll_download",
  "run_quality_check", "convert_track", "tag_track", "finish_rekordbox", "create_playlist", "rename_playlist", "delete_playlist", "add_tracks_to_playlist", "remove_tracks_from_playlist",
]);

function call<T>(name: string, payload?: Record<string, unknown>) {
  const notify = (value: T) => {
    if (MUTATING_COMMANDS.has(name) && typeof window !== "undefined") window.dispatchEvent(new Event(WORKBENCH_DATA_CHANGED_EVENT));
    return value;
  };
  if (isTauri) {
    return invoke<T>(name, payload).then(notify).catch((error) => {
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
  }).then(notify);
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

  importPreviewRows: (rows: ImportPreviewRow[]) => {
    const text = rows
      .filter((row) => !row.skipped && !row.warning && row.artist.trim() && row.title.trim())
      .map((row) => `${row.artist.trim()} - ${row.title.trim()}${row.mixVersion.trim() ? ` (${row.mixVersion.trim()})` : ""}`)
      .join("\n");
    return call<TrackRow[]>("import_text", { text });
  },

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

  listPlaylists: () => call<Playlist[]>("list_playlists"),

  getPlaylistTracks: (playlistId: number) => call<TrackRow[]>("get_playlist_tracks", { playlistId }),

  createPlaylist: (name: string, source = "manual") => call<Playlist>("create_playlist", { name, source }),

  renamePlaylist: (playlistId: number, name: string) => call<void>("rename_playlist", { playlistId, name }),

  deletePlaylist: (playlistId: number) => call<void>("delete_playlist", { playlistId }),

  addTracksToPlaylist: (playlistId: number, trackIds: number[]) => call<void>("add_tracks_to_playlist", { playlistId, trackIds }),

  removeTracksFromPlaylist: (playlistId: number, trackIds: number[]) => call<void>("remove_tracks_from_playlist", { playlistId, trackIds }),

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

  startDownloadFiles: (trackId: number, files: Array<{ username: string; filename: string }>) =>
    call<TrackRow>("start_download_files", { trackId, files }),

  pollDownload: (trackId: number) =>
    call<TrackRow>("poll_download", { trackId }),

  checkDownloadProgress: (trackId: number) =>
    call<{ bytesOnDisk: number | null; bytesTotal: number | null }>("check_download_progress", { trackId }),

  getDownloadStatus: (trackId: number) =>
    call<DownloadStatus>("get_download_status", { trackId }),

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

  getSimilarTracks: (trackId: number, filters?: CosineFilters) =>
    call<SimilarTrack[]>("get_similar_tracks", { trackId, filters: filters ?? null }),

  getSimilarTracksForQuery: (artist: string, title: string, filters?: CosineFilters) =>
    call<SimilarTrack[]>("get_similar_tracks_for_query", { artist, title, filters: filters ?? null }),

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
