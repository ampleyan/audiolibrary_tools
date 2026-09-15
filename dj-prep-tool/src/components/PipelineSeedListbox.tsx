import { useMemo, useState } from "react";
import type { TrackRow } from "../lib/types";

function trackName(track: TrackRow) {
  return track.artist ? `${track.artist} – ${track.title}` : track.title;
}

const STATE_GROUPS: { label: string; states: string[] }[] = [
  { label: "All", states: [] },
  { label: "DJ ready", states: ["dj_ready"] },
  { label: "In progress", states: ["requested", "matched", "approved", "downloading", "downloaded", "converted", "conversion_pending", "ready_for_conversion", "tagging_review", "picard_pending", "ready_for_rekordbox", "rekordbox_pending"] },
  { label: "Needs action", states: ["needs_review", "not_found", "failed", "quality_failed"] },
];

export function PipelineSeedListbox({ tracks, selectedIds, onChange }: { tracks: TrackRow[]; selectedIds: number[]; onChange: (ids: number[]) => void }) {
  const [query, setQuery] = useState("");
  const [stateGroup, setStateGroup] = useState(0);

  const visibleTracks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const group = STATE_GROUPS[stateGroup];
    return tracks.filter((track) => {
      if (group.states.length && !group.states.includes(track.state)) return false;
      if (!needle) return true;
      return `${track.artist} ${track.title} ${track.mix_version ?? ""}`.toLowerCase().includes(needle);
    });
  }, [query, stateGroup, tracks]);

  const toggle = (id: number) => onChange(selectedIds.includes(id) ? selectedIds.filter((selectedId) => selectedId !== id) : [...selectedIds, id]);
  const selectVisible = () => onChange([...new Set([...selectedIds, ...visibleTracks.map((track) => track.id)])]);
  const clear = () => onChange([]);

  return <div className="seed-picker">
    <div className="seed-picker-search" style={{ flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", gap: 5 }}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tracks…" aria-label="Search Pipeline seed tracks" />
        <button type="button" onClick={selectVisible} disabled={!visibleTracks.length} title="Select all visible">All</button>
        <button type="button" onClick={clear} disabled={!selectedIds.length} title="Clear selection">{selectedIds.length > 0 ? `✕ ${selectedIds.length}` : "✕"}</button>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {STATE_GROUPS.map((group, i) => (
          <button key={group.label} type="button" onClick={() => setStateGroup(i)} style={{ background: stateGroup === i ? "#491d3b" : "transparent", color: stateGroup === i ? "#fff0f7" : "#a48e9b", border: `1px solid ${stateGroup === i ? "#6b3152" : "#2d2029"}`, borderRadius: 4, padding: "2px 7px", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>{group.label}</button>
        ))}
      </div>
    </div>
    <div className="seed-picker-list" role="listbox" aria-label="Pipeline tracks for similar search" aria-multiselectable="true">
      {visibleTracks.map((track) => { const sel = selectedIds.includes(track.id); return <button type="button" role="option" aria-selected={sel} className={`seed-picker-option${sel ? " selected" : ""}`} key={track.id} onClick={() => toggle(track.id)}><span className="seed-picker-check">{sel ? "✓" : ""}</span><span className="seed-picker-name" title={trackName(track)}>{trackName(track)}</span><span className="seed-picker-state">{track.state.replace(/_/g, " ")}</span></button>; })}
      {!visibleTracks.length && <span className="seed-picker-empty">No tracks match.</span>}
    </div>
  </div>;
}
