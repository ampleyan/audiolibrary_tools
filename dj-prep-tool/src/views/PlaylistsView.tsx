import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Playlist, TrackRow } from "../lib/types";
import TrackStatusBadge from "../components/TrackStatusBadge";
import { getWorkflowMeta } from "../lib/workflow";

export default function PlaylistsView({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selected, setSelected] = useState<Playlist | null>(null);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const next = await api.listPlaylists();
      setPlaylists(next);
      if (selected) {
        const current = next.find((playlist) => playlist.id === selected.id) ?? null;
        setSelected(current);
        setTracks(current ? await api.getPlaylistTracks(current.id) : []);
      }
    } catch (reason) { setError(String(reason)); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const selectPlaylist = async (playlist: Playlist) => {
    setSelected(playlist); setError(null);
    try { setTracks(await api.getPlaylistTracks(playlist.id)); } catch (reason) { setError(String(reason)); }
  };

  const create = async () => {
    if (!name.trim()) return;
    try { const playlist = await api.createPlaylist(name.trim()); setName(""); await load(); await selectPlaylist(playlist); } catch (reason) { setError(String(reason)); }
  };

  const rename = async () => {
    if (!selected) return;
    const nextName = window.prompt("Rename playlist", selected.name)?.trim();
    if (!nextName || nextName === selected.name) return;
    try { await api.renamePlaylist(selected.id, nextName); await load(); } catch (reason) { setError(String(reason)); }
  };

  const remove = async () => {
    if (!selected || !window.confirm(`Delete playlist “${selected.name}”? Tracks will stay in Library.`)) return;
    try { await api.deletePlaylist(selected.id); setSelected(null); setTracks([]); await load(); } catch (reason) { setError(String(reason)); }
  };

  return <div className="view playlists-view"><header className="work-queue-heading"><div className="view-heading"><h2>Playlists</h2><p>Organize imported tracks into setlists without removing them from Library.</p></div><button className="button secondary" type="button" onClick={() => onNavigate?.("library")}>Browse Library</button></header>
    {error && <div className="inline-error" role="alert"><span>{error}</span><button type="button" onClick={load}>Reload</button></div>}
    <div className="playlist-create"><input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") create(); }} placeholder="New playlist name" aria-label="New playlist name" /><button className="button primary" type="button" onClick={create} disabled={!name.trim()}>Create playlist</button></div>
    <div className="playlist-layout"><aside className="playlist-sidebar"><div className="playlist-sidebar-heading"><strong>Lists</strong><span>{playlists.length}</span></div>{loading ? <p className="playlist-empty">Loading…</p> : playlists.length ? playlists.map((playlist) => <button key={playlist.id} type="button" className={selected?.id === playlist.id ? "is-selected" : ""} onClick={() => selectPlaylist(playlist)}><span>{playlist.source === "rekordbox" ? "◈" : "♫"}</span><span>{playlist.name}</span><small>{playlist.track_count}</small></button>) : <p className="playlist-empty">No playlists yet.</p>}</aside><section className="playlist-detail">{selected ? <><div className="playlist-detail-heading"><div><p className="detail-kicker">{selected.source === "rekordbox" ? "Imported from Rekordbox" : "Manual playlist"}</p><h3>{selected.name}</h3><p>{tracks.length} track{tracks.length === 1 ? "" : "s"}</p></div><div><button className="button secondary" type="button" onClick={rename}>Rename</button><button className="button secondary playlist-delete" type="button" onClick={remove}>Delete</button></div></div><div className="work-queue-list"><div className="work-queue-columns" aria-hidden="true"><span /><span>Track</span><span>Mix</span><span>Status</span><span>Blocker</span><span>Updated</span><span>Next action</span><span /></div>{tracks.length ? tracks.map((track) => <div key={track.id} className="workbench-track-row playlist-track-row"><span aria-hidden="true" /><button className="workbench-track-identity" type="button" onClick={() => onNavigate?.("library")}><strong>{track.artist || "Unknown artist"}</strong><span>{track.title}</span></button><span className="workbench-track-mix">{track.mix_version || "—"}</span><TrackStatusBadge metadata={getWorkflowMeta(track)} /><span className="workbench-track-blocker">{track.error || "No blocker"}</span><time className="workbench-track-updated">{track.updated_at.slice(0, 10)}</time><span className="workbench-track-primary">{getWorkflowMeta(track).nextAction.label}</span><button type="button" className="playlist-remove" onClick={async () => { await api.removeTracksFromPlaylist(selected.id, [track.id]); selectPlaylist(selected); }} aria-label={`Remove ${track.artist} ${track.title}`}>×</button></div>) : <p className="work-queue-empty">This playlist is empty. Add tracks from Library.</p>}</div></> : <div className="empty-state"><h3>Select a playlist</h3><p>Create a playlist or choose one from the Lists panel.</p></div>}</section></div>
  </div>;
}
