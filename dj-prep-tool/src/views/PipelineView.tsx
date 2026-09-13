import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { TrackRow } from "../lib/types";

type PipelineGroupId = "inbox" | "attention" | "progress" | "ready";

const PIPELINE_GROUPS: { id: PipelineGroupId; label: string; description: string; color: string }[] = [
  { id: "inbox", label: "Inbox", description: "New tracks waiting to be reviewed", color: "#60a5fa" },
  { id: "attention", label: "Needs attention", description: "Tracks blocked or needing a fix", color: "#f59e0b" },
  { id: "progress", label: "In progress", description: "Tracks moving through preparation", color: "#a78bfa" },
  { id: "ready", label: "Ready", description: "Tracks ready for DJ use", color: "#34d399" },
];

function groupForTrack(track: TrackRow): PipelineGroupId {
  if (track.state === "dj_ready") return "ready";
  if (track.state === "requested" && !track.search_job_id) return "inbox";
  if (track.state === "needs_review" || track.state === "quality_failed" || track.state === "failed") return "attention";
  if (track.state === "requested" && track.search_job_id) return "attention";
  return "progress";
}

function emptyGroups(): Record<PipelineGroupId, TrackRow[]> {
  return { inbox: [], attention: [], progress: [], ready: [] };
}

function GroupColumn({
  group,
  tracks,
}: {
  group: (typeof PIPELINE_GROUPS)[number];
  tracks: TrackRow[];
}) {
  return (
    <section style={{ minWidth: 260, flex: "1 1 0", background: "#111827", border: "1px solid #293548", borderRadius: 8, padding: 14 }} aria-labelledby={`${group.id}-heading`}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: group.color, display: "inline-block", flexShrink: 0 }} />
        <h3 id={`${group.id}-heading`} style={{ fontSize: 13, color: "#e5e7eb", fontWeight: 600, margin: 0 }}>
          {group.label}
        </h3>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#d1d5db", background: "#1f2937", borderRadius: 999, padding: "1px 7px" }}>
          {tracks.length}
        </span>
      </div>
      <p style={{ color: "#6b7280", fontSize: 11, margin: "0 0 12px", minHeight: 28 }}>{group.description}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {tracks.length === 0 ? (
          <p style={{ color: "#4b5563", fontSize: 12, margin: 0 }}>Nothing here yet.</p>
        ) : tracks.map((track) => (
          <div key={track.id} style={{ background: "#1f2937", borderRadius: 5, padding: "8px 10px", borderLeft: `3px solid ${group.color}66` }}>
            <p style={{ fontSize: 12, color: "#e5e7eb", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${track.artist} – ${track.title}`}>
              {track.artist ? `${track.artist} – ${track.title}` : track.title}
            </p>
            {track.mix_version && <p style={{ fontSize: 10, color: "#6b7280", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.mix_version}</p>}
            {track.error && <p style={{ fontSize: 10, color: "#f87171", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={track.error}>⚠ {track.error}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function PipelineView() {
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.listTracks()
      .then(setTracks)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const byGroup = tracks.reduce((groups, track) => {
    groups[groupForTrack(track)].push(track);
    return groups;
  }, emptyGroups());

  return (
    <div className="view pipeline-view" style={{ padding: 24, color: "#f9fafb" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div className="view-heading">
          <h2>Pipeline</h2>
          <p>{tracks.length} track{tracks.length !== 1 ? "s" : ""} moving from import to DJ-ready.</p>
        </div>
        <button onClick={load} style={{ background: "transparent", color: "#6b7280", border: "1px solid #374151", borderRadius: 5, padding: "6px 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
          Refresh
        </button>
      </div>

      {loading ? (
        <p style={{ color: "#4b5563", fontSize: 14 }}>Loading…</p>
      ) : tracks.length === 0 ? (
        <p style={{ color: "#4b5563", fontSize: 14 }}>No tracks in the Pipeline yet. Add tracks to get started.</p>
      ) : (
        <div className="pipeline-board" style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 16, alignItems: "flex-start" }}>
          {PIPELINE_GROUPS.map((group) => <GroupColumn key={group.id} group={group} tracks={byGroup[group.id]} />)}
        </div>
      )}
    </div>
  );
}
