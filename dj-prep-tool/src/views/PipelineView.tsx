import { useEffect, useState } from "react";
import TrackStatusBadge from "../components/TrackStatusBadge";
import { api, WORKBENCH_DATA_CHANGED_EVENT } from "../lib/api";
import type { TrackRow, WorkflowBucket } from "../lib/types";
import { getWorkflowMeta } from "../lib/workflow";

type PipelineGroupId = WorkflowBucket;

const PIPELINE_GROUPS: { id: PipelineGroupId; label: string; description: string }[] = [
  { id: "inbox", label: "Inbox", description: "New tracks waiting to enter preparation." },
  { id: "needs_attention", label: "Needs attention", description: "Tracks with a user-triggered next action." },
  { id: "running", label: "Running", description: "Downloads and other active work." },
  { id: "ready_to_dj", label: "Ready to DJ", description: "Completed tracks ready for performance." },
];

function groupForTrack(track: TrackRow): PipelineGroupId {
  return getWorkflowMeta(track).bucket;
}

function workViewFor(track: TrackRow): "review" | "downloads" {
  if (track.state === "requested" || track.state === "needs_review" || track.state === "matched" || track.state === "not_found") return "review";
  return "downloads";
}

function emptyGroups(): Record<PipelineGroupId, TrackRow[]> {
  return { inbox: [], needs_attention: [], running: [], ready_to_dj: [] };
}

function GroupColumn({
  group,
  tracks,
  onOpen,
  onNextAction,
}: {
  group: (typeof PIPELINE_GROUPS)[number];
  tracks: TrackRow[];
  onOpen?: (track: TrackRow) => void;
  onNextAction?: (track: TrackRow) => void;
}) {
  return (
    <section className="pipeline-workflow-group" style={{ minWidth: 260, flex: "1 1 0" }} aria-labelledby={`${group.id}-heading`}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <h3 id={`${group.id}-heading`} style={{ fontSize: 13, color: "#e5e7eb", fontWeight: 600, margin: 0 }}>{group.label}</h3>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#d1d5db", background: "#1f2937", borderRadius: 999, padding: "1px 7px" }}>{tracks.length}</span>
      </div>
      <p style={{ color: "#6b7280", fontSize: 11, margin: "0 0 12px", minHeight: 28 }}>{group.description}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {tracks.length === 0 ? (
          <p style={{ color: "#4b5563", fontSize: 12, margin: 0 }}>Nothing here yet.</p>
        ) : tracks.map((track) => (
          <div key={track.id} className="pipeline-workflow-card">
            <span style={{ display: "block", fontSize: 12, color: "#e5e7eb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${track.artist} – ${track.title}`}>
              {track.artist ? `${track.artist} – ${track.title}` : track.title}
            </span>
            <TrackStatusBadge metadata={getWorkflowMeta(track)} />
            {track.mix_version && <span style={{ display: "block", fontSize: 10, color: "#6b7280", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.mix_version}</span>}
            {track.error && <span style={{ display: "block", fontSize: 10, color: track.state === "not_found" ? "#9ca3af" : "#f87171", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={track.error}>{track.state === "not_found" ? "ⓘ" : "⚠"} {track.error}</span>}
            {onNextAction ? <button onClick={() => onNextAction(track)} style={{ ...secondaryButtonStyle, marginTop: 8, width: "100%" }}>{getWorkflowMeta(track).nextAction.label}</button> : onOpen && <button onClick={() => onOpen(track)} style={{ ...secondaryButtonStyle, marginTop: 8, width: "100%" }}>Open details</button>}
          </div>
        ))}
      </div>
    </section>
  );
}

const buttonStyle = { background: "#1e3a5f", color: "#93c5fd", border: "1px solid #1e40af", borderRadius: 5, padding: "7px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" };
const secondaryButtonStyle = { ...buttonStyle, background: "transparent", color: "#9ca3af", borderColor: "#374151" };

export default function PipelineView({ heading = "Overview", onNavigate }: { heading?: string; onNavigate?: (tab: string) => void }) {
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [activities, setActivities] = useState<Array<{ id: number; trackId: number; artist: string; title: string; fromState: string | null; toState: string; createdAt: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const isLibrary = heading === "Library";

  const load = () => {
    setLoading(true);
    Promise.all([api.listTracks(), isLibrary ? api.listActivity(12) : Promise.resolve([])]).then(([nextTracks, nextActivities]) => {
      setTracks(nextTracks);
      setActivities(nextActivities);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(load, []);
  useEffect(() => {
    const handleDataChanged = () => { void load(); };
    window.addEventListener(WORKBENCH_DATA_CHANGED_EVENT, handleDataChanged);
    return () => window.removeEventListener(WORKBENCH_DATA_CHANGED_EVENT, handleDataChanged);
  }, []);

  const byGroup = tracks.reduce((groups, track) => {
    groups[groupForTrack(track)].push(track);
    return groups;
  }, emptyGroups());

  const attentionTrack = tracks.find((track) => groupForTrack(track) === "needs_attention");
  const blockers = byGroup.needs_attention;
  const activeJobs = byGroup.running;
  const continueWork = () => {
    if (!attentionTrack) return;
    onNavigate?.(workViewFor(attentionTrack));
  };
  const takeLibraryAction = async (track: TrackRow) => {
    setActionError(null);
    try {
      if (track.state === "not_found") {
        await api.updateTrackState(track.id, "requested");
        onNavigate?.("review");
        return;
      }
      if (track.state === "dj_ready") {
        if (!track.dj_path) throw new Error("No DJ-ready file path is recorded for this track.");
        await api.openFolder(track.dj_path);
        return;
      }
      onNavigate?.(workViewFor(track));
    } catch (e) {
      setActionError(String(e));
    }
  };
  const healthStats = [
    { label: "Inbox", value: byGroup.inbox.length, color: "#60a5fa" },
    { label: "Needs attention", value: byGroup.needs_attention.length, color: "#f59e0b" },
    { label: "Running", value: byGroup.running.length, color: "#facc15" },
    { label: "DJ-ready", value: byGroup.ready_to_dj.length, color: "#34d399" },
    { label: "Completion", value: tracks.length ? `${Math.round((byGroup.ready_to_dj.length / tracks.length) * 100)}%` : "—", color: "#60a5fa" },
  ];

  return (
    <div className="view pipeline-view" style={{ padding: 24, color: "#f9fafb" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
        <div className="view-heading"><h2>{heading}</h2><p>{isLibrary ? "Your preparation queue. Add tracks, then follow the next step for each track." : `${tracks.length} track${tracks.length !== 1 ? "s" : ""} moving from import to DJ-ready.`}</p></div>
        <div style={{ display: "flex", gap: 8 }}>
          {isLibrary && onNavigate && <button onClick={() => onNavigate("import")} style={buttonStyle}>Add tracks</button>}
          {attentionTrack && <button onClick={continueWork} style={buttonStyle}>Continue</button>}
          <button onClick={load} style={secondaryButtonStyle}>Refresh</button>
        </div>
      </div>

      {isLibrary && actionError && <p style={{ color: "#f87171", fontSize: 12, background: "#1a0c0c", border: "1px solid #7f1d1d", padding: 8, borderRadius: 5 }}>{actionError}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginBottom: 18 }} aria-label="Library health summary">
        {healthStats.map((stat) => (
          <div key={stat.label} style={{ background: "#111827", border: "1px solid #293548", borderRadius: 6, padding: "10px 12px" }}>
            <div style={{ color: "#6b7280", fontSize: 11 }}>{stat.label}</div>
            <div style={{ color: stat.color, fontSize: 20, fontWeight: 600, marginTop: 3 }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {isLibrary && activities.length > 0 && <section style={{ background: "#111827", border: "1px solid #293548", borderRadius: 6, padding: "10px 12px", marginBottom: 18 }} aria-label="Recent activity">
        <h3 style={{ color: "#e5e7eb", fontSize: 12, margin: "0 0 8px" }}>Recent activity</h3>
        <div style={{ display: "grid", gap: 5 }}>
          {activities.map((activity) => <div key={activity.id} style={{ display: "flex", gap: 8, alignItems: "baseline", color: "#9ca3af", fontSize: 11 }}>
            <span style={{ color: "#4b5563", minWidth: 126 }}>{activity.createdAt}</span>
            <span style={{ color: "#d1d5db", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activity.artist ? `${activity.artist} – ${activity.title}` : activity.title}</span>
            <span style={{ color: "#60a5fa", marginLeft: "auto", whiteSpace: "nowrap" }}>{activity.fromState ? `${activity.fromState.replace(/_/g, " ")} → ` : ""}{activity.toState.replace(/_/g, " ")}</span>
          </div>)}
        </div>
      </section>}

      {loading ? <p style={{ color: "#4b5563", fontSize: 14 }}>Loading…</p> : isLibrary ? tracks.length === 0 ? <p style={{ color: "#4b5563", fontSize: 14 }}>No tracks in your Library yet. Add tracks to get started.</p> : <div className="pipeline-board" style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 16, alignItems: "flex-start" }}>{PIPELINE_GROUPS.map((group) => <GroupColumn key={group.id} group={group} tracks={byGroup[group.id]} onNextAction={takeLibraryAction} />)}</div> : tracks.length === 0 ? <p style={{ color: "#4b5563", fontSize: 14 }}>No tracks to prepare yet. Add tracks in Library when you are ready.</p> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        <section style={{ background: "#111827", border: "1px solid #293548", borderRadius: 6, padding: "12px 14px" }} aria-labelledby="overview-blockers">
          <h3 id="overview-blockers" style={{ color: "#e5e7eb", fontSize: 13, margin: "0 0 8px" }}>Blockers</h3>
          {blockers.length === 0 ? <p style={{ color: "#6b7280", fontSize: 12, margin: 0 }}>Nothing needs attention.</p> : <div style={{ display: "grid", gap: 7 }}>{blockers.slice(0, 5).map((track) => <div key={track.id} style={{ color: "#d1d5db", fontSize: 12 }}><span>{track.artist ? `${track.artist} – ${track.title}` : track.title}</span><span style={{ color: "#f59e0b", marginLeft: 8 }}>{getWorkflowMeta(track).nextAction.label}</span></div>)}</div>}
        </section>
        <section style={{ background: "#111827", border: "1px solid #293548", borderRadius: 6, padding: "12px 14px" }} aria-labelledby="overview-active-jobs">
          <h3 id="overview-active-jobs" style={{ color: "#e5e7eb", fontSize: 13, margin: "0 0 8px" }}>Active jobs</h3>
          {activeJobs.length === 0 ? <p style={{ color: "#6b7280", fontSize: 12, margin: 0 }}>No downloads are running.</p> : <div style={{ display: "grid", gap: 7 }}>{activeJobs.slice(0, 5).map((track) => <div key={track.id} style={{ color: "#d1d5db", fontSize: 12 }}>{track.artist ? `${track.artist} – ${track.title}` : track.title}</div>)}</div>}
        </section>
      </div>}
    </div>
  );
}
