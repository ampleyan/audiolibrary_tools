import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { api } from "../lib/api";
import type { Playlist, RankedCandidate, TrackRow as Track } from "../lib/types";
import { getWorkflowMeta } from "../lib/workflow";
import type { TrackMenuAction } from "./TrackRow";
import TrackStatusBadge from "./TrackStatusBadge";

export type InspectorMatchingAction =
  | { id: "approve"; candidate: RankedCandidate }
  | { id: "search_again" | "loose_search" | "mark_unavailable" }
  | { id: "edit_query"; artist: string; title: string; mixVersion: string | null };

export type InspectorPipelineAction =
  | { id: "cancel_download" | "poll_download" | "retry_download" | "retry_quality" | "choose_another_candidate" | "mark_tagged" | "copy_to_rekordbox" | "reveal" }
  | { id: "move_back"; state: Track["state"]; label: string };

const PIPELINE_STAGES = ["download", "convert", "quality", "tag", "rekordbox", "done"] as const;
const MOVE_BACK_TARGETS: Array<{ state: Track["state"]; label: string; stage: typeof PIPELINE_STAGES[number] }> = [
  { state: "requested", label: "Find files", stage: "download" },
  { state: "matched", label: "Match", stage: "download" },
  { state: "approved", label: "Download", stage: "download" },
  { state: "conversion_pending", label: "Convert", stage: "convert" },
  { state: "downloaded", label: "Quality", stage: "quality" },
  { state: "ready_for_conversion", label: "Tag", stage: "tag" },
];

interface ActivityItem {
  id: number;
  trackId: number;
  fromState: string | null;
  toState: string;
  createdAt: string;
}

interface TrackInspectorProps {
  track: Track | null;
  pathMapFrom?: string;
  pathMapTo?: string;
  loading?: boolean;
  error?: string | null;
  busy?: boolean;
  onClose: () => void;
  onPrimaryAction: (track: Track) => void;
  onMenuAction: (track: Track, action: TrackMenuAction) => void;
  onMatchingAction?: (track: Track, action: InspectorMatchingAction) => void | Promise<void>;
  onPipelineAction?: (track: Track, action: InspectorPipelineAction) => void | Promise<void>;
}

function parseCandidates(value: string | null): RankedCandidate[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is RankedCandidate => Boolean(item && typeof item === "object" && "candidate" in item)) : [];
  } catch {
    return [];
  }
}

function fileName(path: string) {
  return path.replace(/\\/g, "/").split("/").pop() || path;
}

function mapPath(path: string, from?: string, to?: string) {
  const normalized = path.replace(/^file:\/\/localhost\//i, "").replace(/^file:\/\/\//i, "").replace(/\\/g, "/");
  if (!from || !to) return normalized;
  const normalizedFrom = from.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedTo = to.replace(/\\/g, "/").replace(/\/$/, "");
  return normalized.startsWith(normalizedFrom) ? normalizedTo + normalized.slice(normalizedFrom.length) : normalized;
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "Unknown";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatSize(bytes: number | null) {
  if (!bytes) return "Unknown";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function pipelineStepStatus(currentStage: string, step: typeof PIPELINE_STAGES[number]) {
  const current = PIPELINE_STAGES.indexOf(currentStage as typeof PIPELINE_STAGES[number]);
  const target = PIPELINE_STAGES.indexOf(step);
  if (current < 0) return "pending";
  if (target < current || currentStage === "done") return "complete";
  return target === current ? "current" : "pending";
}

export default function TrackInspector({ track, pathMapFrom, pathMapTo, loading = false, error = null, busy = false, onClose, onPrimaryAction, onMenuAction, onMatchingAction = () => {}, onPipelineAction = () => {} }: TrackInspectorProps) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activityState, setActivityState] = useState<"idle" | "loading" | "error">("idle");
  const [editingQuery, setEditingQuery] = useState(false);
  const [artist, setArtist] = useState("");
  const [title, setTitle] = useState("");
  const [mixVersion, setMixVersion] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<{ bytesOnDisk: number | null; bytesTotal: number | null; speed: number | null } | null>(null);
  const [moveBackState, setMoveBackState] = useState<Track["state"]>("requested");
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState("");
  const [playlistMessage, setPlaylistMessage] = useState<string | null>(null);
  const progressSample = useRef<{ bytes: number; at: number } | null>(null);

  useEffect(() => {
    if (!track) {
      setActivities([]);
      setActivityState("idle");
      return;
    }
    let active = true;
    setActivityState("loading");
    api.listActivity(50).then((items) => {
      if (!active) return;
      setActivities(items.filter((item) => item.trackId === track.id).slice(0, 8));
      setActivityState("idle");
    }).catch(() => {
      if (active) setActivityState("error");
    });
    return () => { active = false; };
  }, [track?.id]);

  useEffect(() => {
    let active = true;
    api.listPlaylists().then((items) => { if (active) setPlaylists(items); }).catch(() => {});
    return () => { active = false; };
  }, [track?.id]);

  useEffect(() => {
    if (!track || track.state !== "downloading") {
      setDownloadProgress(null);
      progressSample.current = null;
      return;
    }
    let active = true;
    const tick = () => api.checkDownloadProgress(track.id).then((next) => {
      if (!active) return;
      const now = Date.now();
      const previous = progressSample.current;
      const speed = previous && next.bytesOnDisk != null && next.bytesOnDisk >= previous.bytes
        ? (next.bytesOnDisk - previous.bytes) / Math.max(1, (now - previous.at) / 1000)
        : null;
      if (next.bytesOnDisk != null) progressSample.current = { bytes: next.bytesOnDisk, at: now };
      setDownloadProgress({ ...next, speed });
    }).catch(() => {});
    void tick();
    const interval = window.setInterval(tick, 3000);
    return () => { active = false; window.clearInterval(interval); };
  }, [track?.id, track?.state]);

  useEffect(() => {
    setEditingQuery(false);
    setArtist(track?.artist ?? "");
    setTitle(track?.title ?? "");
    setMixVersion(track?.mix_version ?? "");
    setMoveBackState("requested");
  }, [track?.id]);

  if (!track) {
    return (
      <aside className="track-inspector is-empty" aria-label="Track inspector">
        <p>Select a track to inspect its next action and available details.</p>
      </aside>
    );
  }

  const metadata = getWorkflowMeta(track);
  const candidates = parseCandidates(track.candidate_json);
  const rekordboxPath = track.dj_path ? mapPath(track.dj_path, pathMapFrom, pathMapTo) : null;
  const noResults = track.state === "not_found" || (track.state === "requested" && Boolean(track.search_job_id));
  const pipelineStage = metadata.stage;
  const pipelineSteps = [
    { id: "download", label: "Download" },
    { id: "convert", label: "Convert" },
    { id: "quality", label: "Quality" },
    { id: "tag", label: "Tag" },
    { id: "rekordbox", label: "Rekordbox" },
  ] as const;
  const currentStageIndex = PIPELINE_STAGES.indexOf(pipelineStage as typeof PIPELINE_STAGES[number]);
  const moveBackTargets = MOVE_BACK_TARGETS.filter((target) => PIPELINE_STAGES.indexOf(target.stage) < currentStageIndex);
  const selectedMoveTarget = moveBackTargets.find((target) => target.state === moveBackState) ?? moveBackTargets[0];
  const progressPercent = downloadProgress?.bytesOnDisk != null && downloadProgress.bytesTotal
    ? Math.min(100, Math.round(downloadProgress.bytesOnDisk / downloadProgress.bytesTotal * 100))
    : null;
  const etaSeconds = downloadProgress?.speed && downloadProgress.bytesOnDisk != null && downloadProgress.bytesTotal
    ? Math.max(0, Math.round((downloadProgress.bytesTotal - downloadProgress.bytesOnDisk) / downloadProgress.speed))
    : null;

  const addToPlaylist = async () => {
    if (!track || !selectedPlaylistId) return;
    try {
      await api.addTracksToPlaylist(Number(selectedPlaylistId), [track.id]);
      const playlist = playlists.find((item) => item.id === Number(selectedPlaylistId));
      setPlaylistMessage(`Added to ${playlist?.name ?? "playlist"}`);
      setPlaylists(await api.listPlaylists());
    } catch (reason) { setPlaylistMessage(String(reason)); }
  };

  const createPlaylist = async () => {
    const name = window.prompt("New playlist name")?.trim();
    if (!name) return;
    try {
      const playlist = await api.createPlaylist(name);
      setPlaylists((current) => [...current, playlist].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedPlaylistId(String(playlist.id));
      setPlaylistMessage(`Created ${playlist.name}`);
    } catch (reason) { setPlaylistMessage(String(reason)); }
  };

  return (
    <aside className="track-inspector" aria-labelledby="track-inspector-title" aria-busy={loading || busy}>
      <header className="track-inspector-header">
        <div>
          <span>Track inspector</span>
          <h3 id="track-inspector-title">{track.artist ? `${track.artist} – ${track.title}` : track.title}</h3>
          {track.mix_version && <p>{track.mix_version}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label={`Close inspector for ${track.artist ? `${track.artist} – ` : ""}${track.title}`}><X aria-hidden="true" size={17} /></button>
      </header>

      <div className="track-inspector-status">
        <TrackStatusBadge metadata={metadata} />
        <button type="button" onClick={() => track.state === "matched" ? document.querySelector<HTMLButtonElement>(".track-inspector-candidate-action")?.focus() : onPrimaryAction(track)} disabled={busy || !metadata.actionable}>{metadata.nextAction.label}</button>
      </div>

      {loading && <p className="track-inspector-message" role="status">Loading track details…</p>}
      {error && <p className="track-inspector-message is-error" role="alert">{error}</p>}
      {track.error && <p className="track-inspector-message is-warning" role="status">{track.error}</p>}

      <section className="track-inspector-playlists">
        <h4>Playlists</h4>
        <div className="track-inspector-playlist-controls">
          <select value={selectedPlaylistId} onChange={(event) => setSelectedPlaylistId(event.target.value)} disabled={busy} aria-label="Choose playlist">
            <option value="">Choose playlist…</option>
            {playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}
          </select>
          <button type="button" onClick={addToPlaylist} disabled={busy || !selectedPlaylistId}>Add</button>
          <button type="button" onClick={createPlaylist} disabled={busy}>New</button>
        </div>
        {playlistMessage && <p className="track-inspector-muted" role="status">{playlistMessage}</p>}
      </section>

      <section className="track-inspector-search">
        <h4>Search query</h4>
        {editingQuery ? (
          <form onSubmit={(event) => { event.preventDefault(); void onMatchingAction(track, { id: "edit_query", artist: artist.trim(), title: title.trim(), mixVersion: mixVersion.trim() || null }); setEditingQuery(false); }}>
            <label>Artist<input value={artist} onChange={(event) => setArtist(event.target.value)} required /></label>
            <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
            <label>Mix version<input value={mixVersion} onChange={(event) => setMixVersion(event.target.value)} /></label>
            <div><button type="submit" disabled={busy}>Save query</button><button type="button" onClick={() => setEditingQuery(false)}>Cancel</button></div>
          </form>
        ) : (
          <>
            {noResults && <p className="track-inspector-muted">The precise artist/title search returned no shared files. Loose search combines the artist and title into one broader query.</p>}
            <div className="track-inspector-inline-actions">
              <button type="button" onClick={() => onMatchingAction(track, { id: "search_again" })} disabled={busy}>{noResults ? "Search again" : "Search"}</button>
              {noResults && <button type="button" onClick={() => onMatchingAction(track, { id: "loose_search" })} disabled={busy}>Loose search</button>}
              <button type="button" onClick={() => setEditingQuery(true)} disabled={busy}>Edit query</button>
              {noResults && track.state !== "not_found" && <button type="button" onClick={() => onMatchingAction(track, { id: "mark_unavailable" })} disabled={busy}>Mark unavailable</button>}
            </div>
          </>
        )}
      </section>

      {candidates.length > 0 && (
        <section>
          <h4>Candidates <span>{candidates.length}</span></h4>
          <div className="track-inspector-candidates">
            {candidates.map(({ candidate, score }, index) => (
              <div key={`${candidate.username}-${candidate.filename}-${index}`}>
                <strong>{fileName(candidate.filename)}</strong>
                <dl>
                  <dt>User</dt><dd>{candidate.username}</dd>
                  <dt>Format</dt><dd>{candidate.extension.toUpperCase()}</dd>
                  <dt>Bitrate</dt><dd>{candidate.bitRate ? `${candidate.bitRate} kbps` : "Unknown"}</dd>
                  <dt>Sample rate</dt><dd>{candidate.sampleRate ? `${(candidate.sampleRate / 1000).toFixed(1)} kHz` : "Unknown"}</dd>
                  <dt>Duration</dt><dd>{formatDuration(candidate.length)}</dd>
                  <dt>Size</dt><dd>{formatSize(candidate.size)}</dd>
                  <dt>Score</dt><dd>{Math.round(score)}</dd>
                </dl>
                <button className="track-inspector-candidate-action" type="button" onClick={() => onMatchingAction(track, { id: "approve", candidate: { candidate, score } })} disabled={busy}>Approve &amp; next</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {track.selected_filename && (
        <section>
          <h4>Selected file</h4>
          <dl><dt>File</dt><dd title={track.selected_filename}>{fileName(track.selected_filename)}</dd>{track.selected_username && <><dt>User</dt><dd>{track.selected_username}</dd></>}</dl>
        </section>
      )}

      {currentStageIndex >= 0 && (
        <section className="track-inspector-pipeline">
          <h4>Preparation checklist</h4>
          <ol>
            {pipelineSteps.map((step) => {
              const status = pipelineStepStatus(pipelineStage, step.id);
              return <li key={step.id} data-step-status={status}><span aria-hidden="true">{status === "complete" ? "✓" : status === "current" ? "●" : "○"}</span><strong>{step.label}</strong><small>{status === "complete" ? "Complete" : status === "current" ? "Current step" : "Pending"}</small></li>;
            })}
          </ol>
          {track.state === "downloading" && (
            <div className="track-inspector-download-progress" aria-live="polite">
              {progressPercent !== null && <progress max="100" value={progressPercent}>{progressPercent}%</progress>}
              <span>{progressPercent !== null ? `${progressPercent}% · ` : ""}{downloadProgress?.bytesOnDisk != null ? formatSize(downloadProgress.bytesOnDisk) : "Waiting for bytes"}{downloadProgress?.bytesTotal != null ? ` / ${formatSize(downloadProgress.bytesTotal)}` : ""}{downloadProgress?.speed ? ` · ${formatSize(downloadProgress.speed)}/s` : ""}{etaSeconds !== null ? ` · ETA ${Math.ceil(etaSeconds / 60)} min` : ""}</span>
            </div>
          )}
          <div className="track-inspector-inline-actions">
            {track.state === "downloading" && <button type="button" onClick={() => onPipelineAction(track, { id: "poll_download" })} disabled={busy}>Check completion</button>}
            {track.state === "downloading" && <button type="button" onClick={() => onPipelineAction(track, { id: "cancel_download" })} disabled={busy}>Cancel download</button>}
            {track.state === "failed" && track.selected_filename && <button type="button" onClick={() => onPipelineAction(track, { id: "retry_download" })} disabled={busy}>Retry download</button>}
          </div>
        </section>
      )}

      {(track.quality_result || track.quality_notes) && (
        <section>
          <h4>Quality result</h4>
          <dl>{track.quality_result && <><dt>Result</dt><dd>{track.quality_result.replace(/_/g, " ")}</dd></>}{track.quality_notes && <><dt>Notes</dt><dd>{track.quality_notes}</dd></>}</dl>
        </section>
      )}

      {track.state === "quality_failed" && (
        <section className="track-inspector-remediation">
          <h4>Quality remediation</h4>
          <p>The authenticity or spectral check failed. Retry after verifying the file, or choose another candidate and download a different copy.</p>
          <div className="track-inspector-inline-actions"><button type="button" onClick={() => onPipelineAction(track, { id: "retry_quality" })} disabled={busy}>Retry quality check</button><button type="button" onClick={() => onPipelineAction(track, { id: "choose_another_candidate" })} disabled={busy || candidates.length === 0}>Choose another candidate</button></div>
        </section>
      )}

      {["ready_for_conversion", "tagging_review", "picard_pending", "ready_for_rekordbox", "rekordbox_pending", "dj_ready"].includes(track.state) && (
        <section className="track-inspector-tagging">
          <h4>Tagging handoff</h4>
          <dl><dt>Artist</dt><dd>{track.artist || "Unknown"}</dd><dt>Title</dt><dd>{track.title}</dd><dt>Mix</dt><dd>{track.mix_version || "None"}</dd>{track.archive_path && <><dt>Beets file</dt><dd title={track.archive_path}>{fileName(track.archive_path)}</dd></>}</dl>
          {(track.state === "tagging_review" || track.state === "picard_pending") && <><p className="track-inspector-muted">Manual Picard/tagging review is required. Reveal the file, finish the metadata review, then mark tagging complete.</p><div className="track-inspector-inline-actions"><button type="button" onClick={() => onPipelineAction(track, { id: "reveal" })} disabled={busy}>Reveal in Finder/Explorer</button><button type="button" onClick={() => onPipelineAction(track, { id: "mark_tagged" })} disabled={busy}>Mark tagging complete</button></div></>}
        </section>
      )}

      <section>
        <h4>Metadata</h4>
        <dl>
          <dt>Stage</dt><dd>{metadata.stage}</dd>
          <dt>Imported</dt><dd>{track.created_at}</dd>
          <dt>Updated</dt><dd>{track.updated_at}</dd>
          {track.import_tag && <><dt>Import tag</dt><dd>{track.import_tag}</dd></>}
          {track.source_url && <><dt>Source</dt><dd title={track.source_url}>{track.source_url}</dd></>}
        </dl>
      </section>

      {rekordboxPath && (
        <section>
          <h4>Rekordbox path</h4>
          <p className="track-inspector-path">{rekordboxPath}</p>
          <p className="track-inspector-message is-warning">A Rekordbox destination is already recorded. Confirm the existing file before copying to avoid a collision.</p>
        </section>
      )}

      {(track.state === "ready_for_rekordbox" || track.state === "rekordbox_pending") && (
        <section className="track-inspector-handoff">
          <h4>Rekordbox handoff</h4>
          <p className="track-inspector-muted">Copy the prepared file to the configured Rekordbox destination, then verify the library handoff.</p>
          <div className="track-inspector-inline-actions"><button type="button" onClick={() => onPipelineAction(track, { id: "reveal" })} disabled={busy}>Reveal in Finder/Explorer</button><button type="button" onClick={() => onPipelineAction(track, { id: "copy_to_rekordbox" })} disabled={busy}>Copy to Rekordbox</button></div>
        </section>
      )}

      {moveBackTargets.length > 0 && selectedMoveTarget && (
        <section className="track-inspector-move-back">
          <h4>Move back</h4>
          <select aria-label="Move track back to stage" value={selectedMoveTarget.state} onChange={(event) => setMoveBackState(event.target.value as Track["state"])}>{moveBackTargets.map((target) => <option key={target.state} value={target.state}>{target.label}</option>)}</select>
          <button type="button" onClick={() => onPipelineAction(track, { id: "move_back", state: selectedMoveTarget.state, label: selectedMoveTarget.label })} disabled={busy}>Move back to {selectedMoveTarget.label}</button>
        </section>
      )}

      <section>
        <h4>Recent activity</h4>
        {activityState === "loading" ? <p className="track-inspector-muted">Loading activity…</p> : activityState === "error" ? <p className="track-inspector-muted">Activity is unavailable.</p> : activities.length ? (
          <ol className="track-inspector-activity">
            {activities.map((item) => <li key={item.id}><time>{item.createdAt}</time><span>{item.fromState ? `${item.fromState.replace(/_/g, " ")} → ` : ""}{item.toState.replace(/_/g, " ")}</span></li>)}
          </ol>
        ) : <p className="track-inspector-muted">No earlier activity recorded.</p>}
        {noResults && <p className="track-inspector-muted">Latest search: no results. Retry with a broader query, edit the query, or mark the track unavailable.</p>}
      </section>

      <footer className="track-inspector-actions">
        <button type="button" onClick={() => setEditingQuery(true)} disabled={busy}>Edit details</button>
        {(track.downloaded_path || track.archive_path || track.dj_path) && <button type="button" onClick={() => onMenuAction(track, "reveal")}>Reveal in Finder/Explorer</button>}
        <button type="button" onClick={() => onMenuAction(track, "move_stage")}>Move stage</button>
      </footer>
    </aside>
  );
}
