import { useEffect, useMemo, useState } from "react";
import TrackRow from "../components/TrackRow";
import TrackInspector, { type InspectorMatchingAction, type InspectorPipelineAction } from "../components/TrackInspector";
import type { TrackMenuAction } from "../components/TrackRow";
import { api, WORKBENCH_DATA_CHANGED_EVENT } from "../lib/api";
import type { Playlist, TrackRow as Track, TrackState } from "../lib/types";
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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistId, setPlaylistId] = useState("");
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api.listTracks().then(setTracks).catch((e) => setError(String(e))).finally(() => setLoading(false));
  };

  useEffect(load, []);
  useEffect(() => {
    const handleDataChanged = () => { void load(); };
    window.addEventListener(WORKBENCH_DATA_CHANGED_EVENT, handleDataChanged);
    return () => window.removeEventListener(WORKBENCH_DATA_CHANGED_EVENT, handleDataChanged);
  }, []);
  useEffect(() => { api.listPlaylists().then(setPlaylists).catch(() => {}); }, []);

  const addSelectedToPlaylist = async () => {
    if (!playlistId || !selectedIds.size) return;
    try { await api.addTracksToPlaylist(Number(playlistId), [...selectedIds]); setSelectedIds(new Set()); setPlaylists(await api.listPlaylists()); } catch (reason) { setError(String(reason)); }
  };

  const createPlaylist = async () => {
    const nextName = window.prompt("New playlist name")?.trim();
    if (!nextName) return;
    try { const playlist = await api.createPlaylist(nextName); setPlaylists((current) => [...current, playlist].sort((a, b) => a.name.localeCompare(b.name))); setPlaylistId(String(playlist.id)); } catch (reason) { setError(String(reason)); }
  };

  const selectedTrack = tracks.find((track) => track.id === selectedTrackId) ?? null;
  const refresh = async () => setTracks(await api.listTracks());
  const handleMatchingAction = async (track: Track, action: InspectorMatchingAction) => {
    if (action.id === "approve") await api.approveCandidate(track.id, action.candidate.candidate.username, action.candidate.candidate.filename);
    if (action.id === "loose_search") await api.searchTrackLoose(track.id);
    if (action.id === "search_again") await api.searchTrack(track.id);
    if (action.id === "mark_unavailable") await api.updateTrackState(track.id, "not_found");
    if (action.id === "edit_query") await api.updateTrack(track.id, action.artist, action.title, action.mixVersion);
    await refresh();
  };
  const handlePipelineAction = async (track: Track, action: InspectorPipelineAction) => {
    if (action.id === "move_back") await api.updateTrackState(track.id, action.state);
    if (action.id === "cancel_download") await api.cancelDownload(track.id);
    if (action.id === "poll_download") await api.pollDownload(track.id);
    if (action.id === "retry_download") await api.startDownload(track.id);
    if (action.id === "retry_quality") await api.runQualityCheck(track.id);
    if (action.id === "choose_another_candidate") await api.updateTrackState(track.id, "matched");
    if (action.id === "mark_tagged") await api.updateTrackState(track.id, "ready_for_rekordbox");
    if (action.id === "copy_to_rekordbox") await api.finishRekordbox(track.id);
    if (action.id === "reveal") {
      const path = track.dj_path || track.archive_path || track.downloaded_path;
      if (path) await api.openFolder(path);
    }
    await refresh();
  };
  const handleMenuAction = async (track: Track, action: TrackMenuAction) => {
    if (action === "delete") {
      if (!window.confirm(`Delete ${track.artist ? `${track.artist} – ` : ""}${track.title} from the workbench?`)) return;
      await api.deleteTrack(track.id); setSelectedTrackId(null); await refresh(); return;
    }
    if (action === "reveal") {
      const path = track.dj_path || track.archive_path || track.downloaded_path;
      if (path) await api.openFolder(path);
      return;
    }
    setSelectedTrackId(track.id);
  };

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
    {selectedIds.size > 0 && <div className="library-selection-bar"><strong>{selectedIds.size} selected</strong><select value={playlistId} onChange={(event) => setPlaylistId(event.target.value)} aria-label="Choose playlist"><option value="">Choose playlist…</option>{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}</select><button className="button primary" type="button" disabled={!playlistId} onClick={addSelectedToPlaylist}>Add to playlist</button><button className="button secondary" type="button" onClick={createPlaylist}>New playlist</button><button className="button secondary" type="button" onClick={() => setSelectedIds(new Set())}>Clear</button></div>}
    <div className="work-queue-layout library-workbench-layout"><section className="work-queue-list" aria-label="Library track table"><div className="work-queue-columns" aria-hidden="true"><span /><span>Track</span><span>Mix</span><span>Status</span><span>Blocker</span><span>Updated</span><span>Next action</span><span /></div>{loading ? <p className="work-queue-empty">Loading library…</p> : filteredTracks.length ? filteredTracks.map((track) => <TrackRow key={track.id} track={track} metadata={getWorkflowMeta(track)} selected={selectedTrackId === track.id} checked={selectedIds.has(track.id)} showSelection showMenu={false} onCheckedChange={(checked) => setSelectedIds((current) => { const next = new Set(current); checked ? next.add(track.id) : next.delete(track.id); return next; })} onOpen={() => setSelectedTrackId(track.id)} onPrimaryAction={() => openTrack(track)} onMenuAction={(action) => handleMenuAction(track, action)} />) : <p className="work-queue-empty">{tracks.length ? "No tracks match this filter." : "No tracks in your library yet. Add tracks to get started."}</p>}</section><TrackInspector track={selectedTrack} busy={false} onClose={() => setSelectedTrackId(null)} onPrimaryAction={openTrack} onMenuAction={handleMenuAction} onMatchingAction={handleMatchingAction} onPipelineAction={handlePipelineAction} /></div>
  </div>;
}
