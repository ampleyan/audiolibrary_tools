import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { TrackRow, TrackState } from "../lib/types";
import DownloadView from "./DownloadView";
import ReviewView from "./ReviewView";

export type PrepareStage = "find" | "download" | "quality" | "tag" | "rekordbox";

const STAGES: { id: PrepareStage; label: string; description: string; states: TrackState[] }[] = [
  { id: "find", label: "Find files", description: "Search Soulseek and approve the right file.", states: ["requested", "needs_review", "matched"] },
  { id: "download", label: "Download", description: "Start, monitor, or retry approved downloads.", states: ["approved", "downloading", "failed"] },
  { id: "quality", label: "Quality", description: "Check downloaded files before tagging.", states: ["downloaded", "quality_failed"] },
  { id: "tag", label: "Tag", description: "Convert and review files for tagging.", states: ["ready_for_conversion", "tagging_review", "picard_pending"] },
  { id: "rekordbox", label: "Rekordbox", description: "Finish the existing Rekordbox handoff.", states: ["ready_for_rekordbox", "rekordbox_pending", "dj_ready"] },
];

export default function PrepareView({ stage, onStageChange }: { stage: PrepareStage; onStageChange: (stage: PrepareStage) => void }) {
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const activeStage = STAGES.find((item) => item.id === stage) ?? STAGES[0];

  useEffect(() => {
    setLoading(true);
    api.listTracks().then(setTracks).catch(() => {}).finally(() => setLoading(false));
  }, [stage]);

  const count = tracks.filter((track) => activeStage.states.includes(track.state)).length;

  return (
    <div className="view prepare-view" style={{ padding: 24, color: "#f9fafb" }}>
      <div className="view-heading" style={{ marginBottom: 16 }}>
        <h2>Prepare</h2>
        <p>Move your collection from file matching to DJ-ready handoff.</p>
      </div>
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
        <p style={{ color: "#6b7280", fontSize: 12, margin: "0 0 8px" }}>{activeStage.description}</p>
        {stage === "find" ? <ReviewView /> : <DownloadView states={activeStage.states} embedded emptyMessage={`No tracks are ready for ${activeStage.label.toLowerCase()} yet.`} />}
      </section>
    </div>
  );
}
