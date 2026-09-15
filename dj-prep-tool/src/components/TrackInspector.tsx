import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "../lib/api";
import type { RankedCandidate, TrackRow as Track } from "../lib/types";
import { getWorkflowMeta } from "../lib/workflow";
import type { TrackMenuAction } from "./TrackRow";
import TrackStatusBadge from "./TrackStatusBadge";

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

export default function TrackInspector({ track, pathMapFrom, pathMapTo, loading = false, error = null, busy = false, onClose, onPrimaryAction, onMenuAction }: TrackInspectorProps) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activityState, setActivityState] = useState<"idle" | "loading" | "error">("idle");

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
        <button type="button" onClick={() => onPrimaryAction(track)} disabled={busy || !metadata.actionable}>{metadata.nextAction.label}</button>
      </div>

      {loading && <p className="track-inspector-message" role="status">Loading track details…</p>}
      {error && <p className="track-inspector-message is-error" role="alert">{error}</p>}
      {track.error && <p className="track-inspector-message is-warning">{track.error}</p>}

      {candidates.length > 0 && (
        <section>
          <h4>Candidates <span>{candidates.length}</span></h4>
          <div className="track-inspector-candidates">
            {candidates.map(({ candidate, score }, index) => (
              <div key={`${candidate.username}-${candidate.filename}-${index}`}>
                <strong>{fileName(candidate.filename)}</strong>
                <span>{candidate.username} · {candidate.extension.toUpperCase()}{candidate.bitRate ? ` · ${candidate.bitRate} kbps` : ""} · score {Math.round(score)}</span>
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
      </section>

      <footer className="track-inspector-actions">
        <button type="button" onClick={() => onMenuAction(track, "edit")}>Edit details</button>
        {(track.downloaded_path || track.archive_path || track.dj_path) && <button type="button" onClick={() => onMenuAction(track, "reveal")}>Reveal file</button>}
        <button type="button" onClick={() => onMenuAction(track, "move_stage")}>Move stage</button>
      </footer>
    </aside>
  );
}
