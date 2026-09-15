import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { TrackRow, TrackState } from "../lib/types";
import { Button } from "@/components/ui/button";
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

export default function PrepareView({ stage, onStageChange, pathMapFrom, pathMapTo }: { stage: PrepareStage; onStageChange: (stage: PrepareStage) => void; pathMapFrom?: string; pathMapTo?: string }) {
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [continuedTrackId, setContinuedTrackId] = useState<number | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [libSearch, setLibSearch] = useState("");
  const [libSort, setLibSort] = useState<{ col: "artist" | "title"; dir: "asc" | "desc" }>({ col: "artist", dir: "asc" });
  const [libStateFilter, setLibStateFilter] = useState("all");

  const resolveLocalPath = (djPath: string) => {
    // Strip file://localhost/ or file:/// URI prefix
    let p = djPath.replace(/^file:\/\/localhost\//i, "").replace(/^file:\/\/\//i, "");
    // Normalize Windows backslashes
    p = p.replace(/\\/g, "/");
    if (pathMapFrom && pathMapTo) {
      const from = pathMapFrom.replace(/\\/g, "/").replace(/\/$/, "");
      const to = pathMapTo.replace(/\/$/, "");
      if (p.startsWith(from)) p = to + p.slice(from.length);
    }
    return p;
  };

  const act = async (id: number, fn: () => Promise<unknown>) => {
    setBusyIds((s) => new Set(s).add(id));
    try { await fn(); } catch (e) { setLoadError(String(e)); } finally { setBusyIds((s) => { const n = new Set(s); n.delete(id); return n; }); }
  };

  const toggleSort = (col: "artist" | "title") =>
    setLibSort((s) => s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" });
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
  const allLibTracks = tracks;
  const visibleLibraryTracks = allLibTracks
    .filter((t) => {
      if (libStateFilter !== "all" && t.state !== libStateFilter) return false;
      if (libSearch) { const q = libSearch.toLowerCase(); return t.artist.toLowerCase().includes(q) || t.title.toLowerCase().includes(q); }
      return true;
    })
    .sort((a, b) => {
      const va = (a[libSort.col] ?? "").toLowerCase();
      const vb = (b[libSort.col] ?? "").toLowerCase();
      return libSort.dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    });

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

  const libStates = [...new Set(tracks.map((t) => t.state))].sort();

  const libActionLabel = (track: TrackRow) => {
    if (track.state === "dj_ready") return track.dj_path ? "Open" : "Done";
    if (track.state === "not_found") return "Re-search";
    if (["requested", "needs_review"].includes(track.state)) return "Find";
    if (track.state === "matched") return "Match";
    if (["approved", "downloading", "failed"].includes(track.state)) return "Download";
    if (track.state === "conversion_pending") return "Convert";
    if (["downloaded", "quality_failed"].includes(track.state)) return "Quality";
    if (["ready_for_conversion", "tagging_review", "picard_pending"].includes(track.state)) return "Tag";
    return "Rekordbox";
  };

  const libStateColor = (state: TrackState) => {
    if (state === "dj_ready") return "#4ade80";
    if (["failed", "quality_failed", "not_found"].includes(state)) return "#f59e0b";
    if (state === "downloading") return "#facc15";
    return "#a48e9b";
  };

  const libAccentColor = (state: TrackState) => {
    if (state === "dj_ready") return "#ff4fa3";
    if (["failed", "quality_failed", "not_found"].includes(state)) return "#f59e0b";
    if (state === "downloading") return "#facc15";
    return "#352330";
  };

  const handleLibAction = async (track: TrackRow) => {
    if (track.state === "dj_ready") {
      if (track.dj_path) await act(track.id, () => api.openFolder(resolveLocalPath(track.dj_path!)));
      return;
    }
    if (track.state === "not_found") {
      await act(track.id, () => api.updateTrackState(track.id, "requested"));
    }
    onStageChange(stageForTrack(track));
  };

  return (
    <div className="view prepare-view" style={{ padding: 24, color: "#f9fafb" }}>
      <div className="view-heading" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <div><h2>Prepare</h2><p>Follow each track from matching through Beets tagging and Rekordbox.</p></div>
        <Button size="sm" variant={nextTrack ? "outline" : "ghost"} onClick={continuePreparation} disabled={!nextTrack || loading} className="whitespace-nowrap text-blue-300 border-blue-900">{nextTrack ? "Continue preparation" : "Preparation complete"}</Button>
      </div>
      {loadError && <p style={{ color: "#f87171", background: "#1a0c0c", border: "1px solid #7f1d1d", borderRadius: 5, padding: "8px 10px", fontSize: 12 }}><button onClick={load} style={{ background: "transparent", color: "#fca5a5", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}>Reload tracks</button> — {loadError}</p>}
      <div aria-label="Preparation status" className="prepare-stats">
        {bucketCounts.map((bucket, i) => (
          <React.Fragment key={bucket.id}>
            {i > 0 && <div className="prepare-stats-divider" />}
            <div className="prepare-stat">
              <span className="prepare-stat-value" style={{ color: bucket.color }}>{loading ? "–" : bucket.count}</span>
              <span className="prepare-stat-label">{bucket.label}</span>
            </div>
          </React.Fragment>
        ))}
      </div>
      {tracks.length > 0 && (
        <div className="library-section">
          <button className="library-toggle" onClick={() => setShowLibrary((v) => !v)}>
            <span className="library-toggle-icon">{showLibrary ? "▾" : "▸"}</span>
            All tracks
            <span className="library-toggle-meta">{tracks.length} · {tracks.filter((t) => t.state === "dj_ready").length} done</span>
          </button>
          {showLibrary && <>
            <div className="library-toolbar">
              <input className="library-search" value={libSearch} onChange={(e) => setLibSearch(e.target.value)} placeholder="Search…" aria-label="Search tracks" />
              <select className="library-state-select" value={libStateFilter} onChange={(e) => setLibStateFilter(e.target.value)} aria-label="Filter by stage">
                <option value="all">All stages</option>
                {libStates.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </select>
              <span className="library-sort">
                {(["artist", "title"] as const).map((col) => (
                  <button key={col} className={`library-sort-btn${libSort.col === col ? " active" : ""}`} onClick={() => toggleSort(col)}>
                    {col === "artist" ? "Artist" : "Title"}{libSort.col === col ? (libSort.dir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                ))}
              </span>
            </div>
            <div className="library-list">
              {visibleLibraryTracks.length ? visibleLibraryTracks.map((track) => {
                const busy = busyIds.has(track.id);
                return (
                  <div key={track.id} className={`library-row${busy ? " busy" : ""}`} style={{ borderLeftColor: libAccentColor(track.state) }}>
                    <span className="library-row-name">
                      {track.artist ? `${track.artist} – ${track.title}` : track.title}
                      {track.mix_version && <span className="library-row-mix">{track.mix_version}</span>}
                    </span>
                    <span className="library-row-state" style={{ color: libStateColor(track.state) }}>{track.state.replace(/_/g, " ")}</span>
                    <button className="library-row-action" onClick={() => handleLibAction(track)} disabled={busy || (track.state === "dj_ready" && !track.dj_path)}>{libActionLabel(track)}</button>
                    <div className="library-row-actions">
                      {track.dj_path && <button onClick={() => navigator.clipboard.writeText(track.dj_path!)} title="Copy path">⎘</button>}
                      <button onClick={() => act(track.id, () => api.updateTrackState(track.id, "requested").then(load))} title="Re-queue" disabled={busy}>↺</button>
                      <button onClick={() => act(track.id, () => api.deleteTrack(track.id).then(() => setTracks((t) => t.filter((x) => x.id !== track.id))))} title="Remove" disabled={busy} className="destructive">✕</button>
                    </div>
                  </div>
                );
              }) : <div className="library-empty">No tracks match.</div>}
            </div>
          </>}
        </div>
      )}
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
      <nav aria-label="Preparation stages" className="prepare-stage-tabs">
        {STAGES.map((item) => {
          const stageCount = tracks.filter((track) => item.states.includes(track.state)).length;
          const active = item.id === activeStage.id;
          return <button key={item.id} onClick={() => onStageChange(item.id)} aria-current={active ? "step" : undefined} aria-label={`${item.label}, ${stageCount} track${stageCount === 1 ? "" : "s"}`}>
            {item.label}<span>{loading ? "–" : stageCount}</span>
          </button>;
        })}
      </nav>
      <section aria-labelledby="prepare-stage-title">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
          <h3 id="prepare-stage-title" style={{ fontSize: 15, color: "#e5e7eb", margin: 0, fontWeight: 600 }}>{activeStage.label}</h3>
          <span aria-live="polite" style={{ color: "#7a6570", fontSize: 12 }}>{loading ? "Loading…" : `${count} track${count === 1 ? "" : "s"}`}</span>
        </div>
        {stage === "find" ? <ReviewView states={FIND_STATES} onTrackChanged={(updated) => setTracks((current) => current.map((track) => track.id === updated.id ? updated : track))} /> : stage === "match" ? <ReviewView states={MATCH_STATES} onTrackChanged={(updated) => setTracks((current) => current.map((track) => track.id === updated.id ? updated : track))} /> : <DownloadView states={activeStage.states} embedded selectedTrackId={continuedTrack?.id} onTrackChanged={(updated) => setTracks((current) => current.map((track) => track.id === updated.id ? updated : track))} emptyMessage={`No tracks are ready for ${activeStage.label.toLowerCase()} yet.`} />}
      </section>
    </div>
  );
}
