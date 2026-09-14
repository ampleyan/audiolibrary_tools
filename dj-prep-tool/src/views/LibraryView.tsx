import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { TrackRow } from "../lib/types";

const buttonStyle = { background: "#1e3a5f", color: "#93c5fd", border: "1px solid #1e40af", borderRadius: 5, padding: "7px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" };
const secondaryButtonStyle = { ...buttonStyle, background: "transparent", color: "#9ca3af", borderColor: "#374151" };

function trackName(track: TrackRow) {
  return track.artist ? `${track.artist} – ${track.title}` : track.title;
}

function actionLabel(track: TrackRow) {
  if (track.state === "not_found") return "Search again";
  if (["requested", "needs_review", "matched"].includes(track.state)) return "Review match";
  if (track.state === "approved") return "Start download";
  if (track.state === "downloading") return "Monitor download";
  if (["downloaded", "quality_failed"].includes(track.state)) return "Quality check";
  if (track.state === "ready_for_conversion") return "Beets tagging";
  if (["tagging_review", "picard_pending"].includes(track.state)) return "Review tagging";
  if (["ready_for_rekordbox", "rekordbox_pending"].includes(track.state)) return "Rekordbox";
  if (track.state === "dj_ready") return "Open DJ-ready file";
  return "Review error";
}

function workViewFor(track: TrackRow) {
  return ["requested", "needs_review", "matched", "not_found"].includes(track.state) ? "review" : "downloads";
}

export default function LibraryView({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api.listTracks().then(setTracks).catch((e) => setError(String(e))).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filteredTracks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tracks.filter((track) => {
      if (stateFilter !== "all" && track.state !== stateFilter) return false;
      if (!needle) return true;
      return `${track.artist} ${track.title} ${track.mix_version ?? ""}`.toLowerCase().includes(needle);
    });
  }, [query, stateFilter, tracks]);

  const openTrack = async (track: TrackRow) => {
    setError(null);
    try {
      if (track.state === "not_found") {
        await api.updateTrackState(track.id, "requested");
        load();
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
      setError(String(e));
    }
  };

  return (
    <div className="view library-view" style={{ padding: 24, color: "#f9fafb" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
        <div className="view-heading"><h2>Library</h2><p>Every imported track in one searchable place.</p></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => onNavigate?.("import")} style={buttonStyle}>Add tracks</button>
          <button onClick={load} style={secondaryButtonStyle}>Refresh</button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search artist, title, or mix" aria-label="Search library" style={{ flex: 1, background: "#111827", color: "#e5e7eb", border: "1px solid #374151", borderRadius: 5, padding: "8px 10px", font: "12px inherit" }} />
        <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} aria-label="Filter library by stage" style={{ background: "#111827", color: "#9ca3af", border: "1px solid #374151", borderRadius: 5, padding: "8px 10px", fontSize: 12, fontFamily: "inherit" }}>
          <option value="all">All stages</option>
          {[...new Set(tracks.map((track) => track.state))].sort().map((state) => <option key={state} value={state}>{state.replace(/_/g, " ")}</option>)}
        </select>
      </div>
      {error && <p style={{ color: "#f87171", background: "#1a0c0c", border: "1px solid #7f1d1d", padding: 8, borderRadius: 5, fontSize: 12 }}>{error}</p>}
      {loading ? <p style={{ color: "#4b5563", fontSize: 14 }}>Loading…</p> : filteredTracks.length === 0 ? <p style={{ color: "#4b5563", fontSize: 14 }}>{tracks.length ? "No tracks match this filter." : "No tracks in your library yet. Add tracks to get started."}</p> : (
        <div style={{ display: "grid", gap: 7 }}>
          {filteredTracks.map((track) => (
            <div key={track.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "#111827", border: "1px solid #293548", borderRadius: 6, padding: "10px 12px" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ color: "#e5e7eb", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={trackName(track)}>{trackName(track)}</div>
                {track.mix_version && <div style={{ color: "#6b7280", fontSize: 11, marginTop: 3 }}>{track.mix_version}</div>}
              </div>
              <span style={{ color: track.state === "dj_ready" ? "#34d399" : track.state === "failed" || track.state === "quality_failed" ? "#f59e0b" : "#93c5fd", fontSize: 11, whiteSpace: "nowrap" }}>{track.state.replace(/_/g, " ")}</span>
              <button onClick={() => openTrack(track)} style={{ ...secondaryButtonStyle, whiteSpace: "nowrap" }}>{actionLabel(track)}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
