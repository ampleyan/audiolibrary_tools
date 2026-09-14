import { useMemo, useState } from "react";
import type { TrackRow } from "../lib/types";

function trackName(track: TrackRow) {
  return track.artist ? `${track.artist} – ${track.title}` : track.title;
}

export function PipelineSeedListbox({ tracks, selectedIds, onChange }: { tracks: TrackRow[]; selectedIds: number[]; onChange: (ids: number[]) => void }) {
  const [query, setQuery] = useState("");
  const visibleTracks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tracks;
    return tracks.filter((track) => `${track.artist} ${track.title} ${track.mix_version ?? ""} ${track.state}`.toLowerCase().includes(needle));
  }, [query, tracks]);

  const toggle = (id: number) => onChange(selectedIds.includes(id) ? selectedIds.filter((selectedId) => selectedId !== id) : [...selectedIds, id]);
  const selectVisible = () => onChange([...new Set([...selectedIds, ...visibleTracks.map((track) => track.id)])]);
  const clear = () => onChange([]);

  return <div className="seed-picker">
    <div className="seed-picker-header"><div><strong>Choose seed tracks</strong><span>Select one or more Pipeline tracks</span></div><b>{selectedIds.length}</b></div>
    <div className="seed-picker-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tracks" aria-label="Search Pipeline seed tracks" /><button type="button" onClick={selectVisible} disabled={!visibleTracks.length}>All</button><button type="button" onClick={clear} disabled={!selectedIds.length}>Clear</button></div>
    <div className="seed-picker-list" role="listbox" aria-label="Pipeline tracks for similar search" aria-multiselectable="true">
      {visibleTracks.map((track) => { const selected = selectedIds.includes(track.id); return <button type="button" role="option" aria-selected={selected} className={`seed-picker-option${selected ? " selected" : ""}`} key={track.id} onClick={() => toggle(track.id)}><span className="seed-picker-check">{selected ? "✓" : ""}</span><span className="seed-picker-name" title={trackName(track)}>{trackName(track)}</span><span className="seed-picker-state">{track.state.replace(/_/g, " ")}</span></button>; })}
      {!visibleTracks.length && <span className="seed-picker-empty">No Pipeline tracks match.</span>}
    </div>
  </div>;
}
