import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { TrackRow, TrackState } from "../lib/types";
import DownloadView from "./DownloadView";
import ReviewView from "./ReviewView";

export type PrepareStage = "find" | "match" | "download" | "convert" | "quality" | "tag" | "rekordbox";
type PreparationBucket = "needsAction" | "running" | "blocked" | "done";

const FIND_STATES: TrackState[] = ["requested", "needs_review", "not_found"];
const MATCH_STATES: TrackState[] = ["matched"];

const STAGES: { id: PrepareStage; label: string; description: string; primaryAction: string; states: TrackState[] }[] = [
  { id: "find", label: "Find files", description: "Search Soulseek and find candidate files for each track.", primaryAction: "Search for a file", states: ["requested", "needs_review", "not_found"] },
  { id: "match", label: "Match", description: "Choose the right candidate file before downloading.", primaryAction: "Approve a match", states: ["matched"] },
  { id: "download", label: "Download", description: "Start an approved download and monitor it to completion.", primaryAction: "Start download", states: ["approved", "downloading", "failed"] },
  { id: "convert", label: "Convert", description: "Convert FLAC and other lossless files to MP3 before quality checking.", primaryAction: "Convert to MP3", states: ["conversion_pending"] },
  { id: "quality", label: "Quality", description: "Check MP3 files before Beets tagging.", primaryAction: "Run quality check", states: ["downloaded", "converted", "quality_failed"] },
  { id: "tag", label: "Tag", description: "Run Beets after a file passes the quality check.", primaryAction: "Run Beets tagging", states: ["ready_for_conversion", "tagging_review", "picard_pending"] },
  { id: "rekordbox", label: "Rekordbox", description: "Complete the Rekordbox handoff after tagging.", primaryAction: "Mark imported", states: ["ready_for_rekordbox", "rekordbox_pending", "dj_ready"] },
];

const BUCKETS: { id: PreparationBucket; label: string; color: string }[] = [
  { id: "needsAction", label: "Needs action", color: "#60a5fa" },
  { id: "running", label: "Running", color: "#facc15" },
  { id: "blocked", label: "Blocked", color: "#fb923c" },
  { id: "done", label: "Done", color: "#4ade80" },
];

function stageForTrack(track: TrackRow): PrepareStage {
  if (["requested", "needs_review", "not_found"].includes(track.state)) return "find";
  if (track.state === "matched") return "match";
  if (["approved", "downloading", "failed"].includes(track.state)) return "download";
  if (track.state === "conversion_pending") return "convert";
  if (["downloaded", "converted", "quality_failed"].includes(track.state)) return "quality";
  if (["ready_for_conversion", "tagging_review", "picard_pending"].includes(track.state)) return "tag";
  return "rekordbox";
}

function bucketForTrack(track: TrackRow): PreparationBucket {
  if (track.state === "dj_ready") return "done";
  if (track.state === "downloading") return "running";
  if (track.state === "not_found" || track.state === "needs_review" || track.state === "quality_failed" || track.state === "tagging_review" || track.state === "picard_pending" || track.state === "failed" || (track.state === "requested" && !!track.search_job_id)) return "blocked";
  return "needsAction";
}

function trackName(track: TrackRow) {
  return track.artist ? `${track.artist} – ${track.title}` : track.title;
}

export default function PrepareView({ stage, onStageChange }: { stage: PrepareStage; onStageChange: (stage: PrepareStage) => void }) {
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [continuedTrackId, setContinuedTrackId] = useState<number | null>(null);
  const activeStage = STAGES.find((item) => item.id === stage) ?? STAGES[0];

  const load = () => {
    setLoading(true);
    setLoadError(null);
    api.listTracks().then(setTracks).catch((error) => setLoadError(String(error))).finally(() => setLoading(false));
  };

  useEffect(load, [stage]);

  const incompleteTracks = tracks
    .filter((track) => track.state !== "dj_ready")
    .sort((a, b) => {
      const stageDifference = STAGES.findIndex((item) => item.id === stageForTrack(a)) - STAGES.findIndex((item) => item.id === stageForTrack(b));
      if (stageDifference) return stageDifference;
      return a.created_at.localeCompare(b.created_at) || a.id - b.id;
    });
  const nextTrack = incompleteTracks[0];
  const continuedTrack = tracks.find((track) => track.id === continuedTrackId) ?? null;
  const selectedStage = continuedTrack ? stageForTrack(continuedTrack) : null;
  const count = tracks.filter((track) => activeStage.states.includes(track.state)).length;
  const bucketCounts = BUCKETS.map((bucket) => ({ ...bucket, count: tracks.filter((track) => bucketForTrack(track) === bucket.id).length }));

  const continuePreparation = () => {
    if (!nextTrack) return;
    setContinuedTrackId(nextTrack.id);
    onStageChange(stageForTrack(nextTrack));
  };

  const recover = async () => {
    if (!continuedTrack) return;
    try {
      if (continuedTrack.state === "not_found") {
        await api.updateTrackState(continuedTrack.id, "requested");
        setContinuedTrackId(null);
        onStageChange("find");
        load();
        return;
      }
      onStageChange(stageForTrack(continuedTrack));
    } catch (error) {
      setLoadError(String(error));
    }
  };

  const recoveryLabel = continuedTrack?.state === "not_found" ? "Search again" : `Open ${selectedStage ? STAGES.find((item) => item.id === selectedStage)?.label : "stage"}`;

  return (
    <div className="view prepare-view" style={{ padding: 24, color: "#f9fafb" }}>
      <div className="view-heading" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <div><h2>Prepare</h2><p>Follow each track from matching through Beets tagging and Rekordbox.</p></div>
        <button onClick={continuePreparation} disabled={!nextTrack || loading} style={{ background: !nextTrack || loading ? "#111827" : "#1e3a5f", color: !nextTrack || loading ? "#4b5563" : "#93c5fd", border: "1px solid #1e40af", borderRadius: 5, padding: "7px 12px", fontSize: 12, cursor: !nextTrack || loading ? "not-allowed" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{nextTrack ? "Continue preparation" : "Preparation complete"}</button>
      </div>
      {loadError && <p style={{ color: "#f87171", background: "#1a0c0c", border: "1px solid #7f1d1d", borderRadius: 5, padding: "8px 10px", fontSize: 12 }}><button onClick={load} style={{ background: "transparent", color: "#fca5a5", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}>Reload tracks</button> — {loadError}</p>}
      <div aria-label="Preparation status" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginBottom: 18 }}>
        {bucketCounts.map((bucket) => <div key={bucket.id} style={{ background: "#111827", border: "1px solid #293548", borderRadius: 6, padding: "10px 12px" }}><div style={{ color: "#6b7280", fontSize: 11 }}>{bucket.label}</div><div style={{ color: bucket.color, fontSize: 20, fontWeight: 600, marginTop: 3 }}>{loading ? "…" : bucket.count}</div></div>)}
      </div>
      {continuedTrack && <section aria-label="Current preparation track" style={{ background: "#111827", border: "1px solid #1e40af", borderRadius: 6, padding: "10px 12px", marginBottom: 18 }}>
        <div style={{ color: "#93c5fd", fontSize: 11, marginBottom: 4 }}>CONTINUING</div>
        <div style={{ color: "#e5e7eb", fontSize: 14, fontWeight: 600 }}>{trackName(continuedTrack)}</div>
        <div aria-label="Preparation step indicator" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {STAGES.map((item, index) => {
            const currentIndex = STAGES.findIndex((stageItem) => stageItem.id === selectedStage);
            const state = index < currentIndex ? "Complete" : item.id === selectedStage ? "Current" : "Later";
            return <span key={item.id} style={{ color: item.id === selectedStage ? "#93c5fd" : index < currentIndex ? "#4ade80" : "#6b7280", border: "1px solid #374151", borderRadius: 999, padding: "3px 7px", fontSize: 10 }}>{item.label}: {state}</span>;
          })}
        </div>
        {continuedTrack.error && <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, color: "#fca5a5", fontSize: 12 }}><span style={{ flex: 1 }}>{continuedTrack.error}</span><button onClick={recover} style={{ background: "transparent", color: "#fca5a5", border: "1px solid #7f1d1d", borderRadius: 4, padding: "4px 8px", cursor: "pointer", fontFamily: "inherit", fontSize: 11 }}>{recoveryLabel}</button></div>}
      </section>}
      <div aria-label="Preparation stages" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
        {STAGES.map((item) => {
          const stageCount = tracks.filter((track) => item.states.includes(track.state)).length;
          const active = item.id === activeStage.id;
          return <button key={item.id} onClick={() => onStageChange(item.id)} aria-current={active ? "step" : undefined} aria-label={`${item.label}, ${stageCount} track${stageCount === 1 ? "" : "s"}`} style={{ background: active ? "#1e3a5f" : "transparent", color: active ? "#93c5fd" : "#9ca3af", border: `1px solid ${active ? "#1e40af" : "#374151"}`, borderRadius: 5, padding: "7px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
            {item.label} ({loading ? "…" : stageCount})
          </button>;
        })}
      </div>
      <section aria-labelledby="prepare-stage-title">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
          <h3 id="prepare-stage-title" style={{ fontSize: 16, color: "#e5e7eb", margin: 0 }}>{activeStage.label}</h3>
          <span aria-live="polite" style={{ color: "#60a5fa", fontSize: 12 }}>{loading ? "Loading…" : `${count} track${count === 1 ? "" : "s"}`}</span>
        </div>
        <p style={{ color: "#6b7280", fontSize: 12, margin: "0 0 4px" }}>{activeStage.description}</p>
        <p style={{ color: "#93c5fd", fontSize: 12, margin: "0 0 8px" }}>Primary action: {activeStage.primaryAction}</p>
        {stage === "find" ? <ReviewView states={FIND_STATES} onTrackChanged={(updated) => setTracks((current) => current.map((track) => track.id === updated.id ? updated : track))} /> : stage === "match" ? <ReviewView states={MATCH_STATES} onTrackChanged={(updated) => setTracks((current) => current.map((track) => track.id === updated.id ? updated : track))} /> : <DownloadView states={activeStage.states} embedded selectedTrackId={continuedTrack?.id} onTrackChanged={(updated) => setTracks((current) => current.map((track) => track.id === updated.id ? updated : track))} emptyMessage={`No tracks are ready for ${activeStage.label.toLowerCase()} yet.`} />}
      </section>
    </div>
  );
}
