import { useEffect, useMemo, useState } from "react";
import TrackRow from "../components/TrackRow";
import { api } from "../lib/api";
import type { TrackRow as Track, TrackState } from "../lib/types";
import { getWorkflowMeta } from "../lib/workflow";

type SortKey = "priority" | "artist" | "title" | "status" | "updated" | "created";

function workViewFor(track: Track) {
  return ["requested", "needs_review", "matched", "not_found"].includes(track.state) ? "review" : "downloads";
}

export default function LibraryView({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<TrackState | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [descending, setDescending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api.listTracks().then(setTracks).catch((e) => setError(String(e))).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filteredTracks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const result = tracks.filter((track) => {
      if (stateFilter !== "all" && track.state !== stateFilter) return false;
      if (!needle) return true;
      return [track.artist, track.title, track.mix_version ?? "", track.error ?? "", track.state]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
    const compare = (left: Track, right: Track) => {
      if (sortKey === "status") return getWorkflowMeta(left).statusLabel.localeCompare(getWorkflowMeta(right).statusLabel);
      if (sortKey === "updated" || sortKey === "created") {
        const leftDate = sortKey === "updated" ? left.updated_at : left.created_at;
        const rightDate = sortKey === "updated" ? right.updated_at : right.created_at;
        return (Date.parse(leftDate) || 0) - (Date.parse(rightDate) || 0);
      }
      if (sortKey === "priority") return Number(getWorkflowMeta(right).actionable) - Number(getWorkflowMeta(left).actionable) || getWorkflowMeta(left).statusLabel.localeCompare(getWorkflowMeta(right).statusLabel);
      return left[sortKey].localeCompare(right[sortKey]);
    };
    return result.sort((left, right) => (descending ? -1 : 1) * compare(left, right) || left.id - right.id);
  }, [descending, query, sortKey, stateFilter, tracks]);

  const openTrack = async (track: Track) => {
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

  return <div className="view library-view">
    <header className="work-queue-heading"><div className="view-heading"><h2>Library</h2><p>Every imported track in one searchable place.</p></div><div className="library-heading-actions"><button className="button primary" type="button" onClick={() => onNavigate?.("import")}>Add tracks</button><button className="button secondary" type="button" onClick={load}>Refresh</button></div></header>
    {error && <div className="inline-error" role="alert"><span>{error}</span><button type="button" onClick={load}>Reload</button></div>}
    <div className="workbench-table-toolbar" aria-label="Filter and sort library tracks">
      <label className="workbench-table-search"><span>Filter tracks</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Artist, title, mix, status…" aria-label="Search library" /></label>
      <label className="workbench-table-select"><span>Status</span><select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as TrackState | "all")}><option value="all">All statuses</option>{Array.from(new Set(tracks.map((track) => track.state))).sort().map((state) => <option key={state} value={state}>{getWorkflowMeta({ state } as Track).statusLabel}</option>)}</select></label>
      <label className="workbench-table-select"><span>Sort by</span><select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}><option value="priority">Priority</option><option value="artist">Artist</option><option value="title">Title</option><option value="status">Status</option><option value="updated">Last updated</option><option value="created">Date added</option></select></label>
      <button className="workbench-sort-direction" type="button" onClick={() => setDescending((value) => !value)} aria-label={`Sort ${descending ? "ascending" : "descending"}`}>{descending ? "↓ Descending" : "↑ Ascending"}</button>
      {(query || stateFilter !== "all") && <button className="workbench-clear-filters" type="button" onClick={() => { setQuery(""); setStateFilter("all"); }}>Clear</button>}
      <span className="workbench-table-result-count">{filteredTracks.length} of {tracks.length} shown</span>
    </div>
    <div className="work-queue-layout library-workbench-layout"><section className="work-queue-list" aria-label="Library track table"><div className="work-queue-columns" aria-hidden="true"><span /><span>Track</span><span>Mix</span><span>Status</span><span>Blocker</span><span>Updated</span><span>Next action</span><span /></div>{loading ? <p className="work-queue-empty">Loading library…</p> : filteredTracks.length ? filteredTracks.map((track) => <TrackRow key={track.id} track={track} metadata={getWorkflowMeta(track)} selected={false} showSelection={false} showMenu={false} onOpen={() => openTrack(track)} onPrimaryAction={() => openTrack(track)} onMenuAction={() => {}} />) : <p className="work-queue-empty">{tracks.length ? "No tracks match this filter." : "No tracks in your library yet. Add tracks to get started."}</p>}</section></div>
  </div>;
}
