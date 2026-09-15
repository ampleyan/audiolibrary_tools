import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "../lib/api";
import type { RankedCandidate, TrackRow as Track } from "../lib/types";
import { getWorkflowMeta } from "../lib/workflow";
import type { TrackMenuAction } from "./TrackRow";
import TrackStatusBadge from "./TrackStatusBadge";

export type InspectorMatchingAction =
  | { id: "approve"; candidate: RankedCandidate }
  | { id: "search_again" | "loose_search" | "mark_unavailable" }
  | { id: "edit_query"; artist: string; title: string; mixVersion: string | null };

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
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function TrackInspector({ track, pathMapFrom, pathMapTo, loading = false, error = null, busy = false, onClose, onPrimaryAction, onMenuAction, onMatchingAction = () => {} }: TrackInspectorProps) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activityState, setActivityState] = useState<"idle" | "loading" | "error">("idle");
  const [editingQuery, setEditingQuery] = useState(false);
  const [artist, setArtist] = useState("");
  const [title, setTitle] = useState("");
  const [mixVersion, setMixVersion] = useState("");

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
    setEditingQuery(false);
    setArtist(track?.artist ?? "");
    setTitle(track?.title ?? "");
    setMixVersion(track?.mix_version ?? "");
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
  const canEditQuery = ["requested", "needs_review", "not_found", "matched"].includes(track.state);

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

      {(noResults || canEditQuery) && (
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
                {noResults && <button type="button" onClick={() => onMatchingAction(track, { id: "loose_search" })} disabled={busy}>Loose search</button>}
                {noResults && <button type="button" onClick={() => onMatchingAction(track, { id: "search_again" })} disabled={busy}>Search again</button>}
                <button type="button" onClick={() => setEditingQuery(true)} disabled={busy}>Edit query</button>
                {noResults && track.state !== "not_found" && <button type="button" onClick={() => onMatchingAction(track, { id: "mark_unavailable" })} disabled={busy}>Mark unavailable</button>}
              </div>
            </>
          )}
        </section>
      )}

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

      {(track.quality_result || track.quality_notes) && (
        <section>
          <h4>Quality result</h4>
          <dl>{track.quality_result && <><dt>Result</dt><dd>{track.quality_result.replace(/_/g, " ")}</dd></>}{track.quality_notes && <><dt>Notes</dt><dd>{track.quality_notes}</dd></>}</dl>
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
        <button type="button" onClick={() => onMenuAction(track, "edit")}>Edit details</button>
        {(track.downloaded_path || track.archive_path || track.dj_path) && <button type="button" onClick={() => onMenuAction(track, "reveal")}>Reveal file</button>}
        <button type="button" onClick={() => onMenuAction(track, "move_stage")}>Move stage</button>
      </footer>
    </aside>
  );
}
