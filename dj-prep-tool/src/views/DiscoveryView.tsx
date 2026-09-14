import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { RekordboxTrack, SimilarTrack } from "../lib/types";

function nameOf(track: { artist: string; title: string }) {
  return track.artist ? `${track.artist} – ${track.title}` : track.title;
}

export default function DiscoveryView({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [mode, setMode] = useState("library");
  const [tracks, setTracks] = useState<RekordboxTrack[]>([]);
  const [selected, setSelected] = useState<RekordboxTrack | null>(null);
  const [results, setResults] = useState<SimilarTrack[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [finding, setFinding] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (refresh = false) => {
    setError(null);
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      const settings = await api.getSettings();
      const xmlPath = settings.rekordboxXmlPath.trim();
      if (!xmlPath) throw new Error("Rekordbox XML not configured. Choose the XML file in Settings.");
      const preview = await api.checkRekordbox(xmlPath);
      setTracks(preview.tracksInXml);
      setSelected((current) => current && preview.tracksInXml.some((track) => nameOf(track) === nameOf(current)) ? current : preview.tracksInXml[0] ?? null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const visibleTracks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tracks.filter((track) => {
      if (filter === "library" && !track.inLibrary) return false;
      if (filter === "gap" && track.inLibrary) return false;
      if (!needle) return true;
      return `${track.artist} ${track.title} ${track.album ?? ""} ${track.genre ?? ""} ${track.playlists.join(" ")}`.toLowerCase().includes(needle);
    });
  }, [filter, query, tracks]);

  const findRelated = async () => {
    if (!selected) return;
    setFinding(true);
    setError(null);
    setMode("related");
    try {
      setResults(await api.getSimilarTracksForQuery(selected.artist, selected.title));
    } catch (e) {
      setError(String(e));
    } finally {
      setFinding(false);
    }
  };

  const addToPipeline = async (track: { artist: string; title: string }) => {
    setAdding(true);
    setError(null);
    try {
      const rows = await api.importText(`${track.artist} - ${track.title}`);
      if (selected && nameOf(selected) === nameOf(track)) setSelected({ ...selected, inLibrary: true });
      if (rows.length) setTracks((current) => current.map((item) => nameOf(item) === nameOf(track) ? { ...item, inLibrary: true } : item));
    } catch (e) {
      setError(String(e));
    } finally {
      setAdding(false);
    }
  };

  const gapCount = tracks.filter((track) => !track.inLibrary).length;

  return <div className="view discovery-view">
    <div className="discovery-heading"><div className="view-heading"><h2>Discover</h2><p>Explore your Rekordbox library and find what belongs next.</p></div><button className="button secondary" onClick={() => load(true)} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh XML"}</button></div>
    <div className="discovery-tabs" role="tablist" aria-label="Discovery modes"><button role="tab" aria-selected={mode === "library"} onClick={() => setMode("library")}>Rekordbox library</button><button role="tab" aria-selected={mode === "related"} onClick={() => setMode("related")} disabled={!selected}>Related music</button></div>
    {error && <div className="inline-error" role="alert"><span>{error}</span><button onClick={() => onNavigate("setup")}>Open Settings</button></div>}
    {loading ? <div className="empty-state">Loading Rekordbox library…</div> : !error && !tracks.length ? <div className="empty-state">No tracks were found in this Rekordbox XML.</div> : <>
      {mode === "library" && <><div className="discovery-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search artist, title, genre, playlist" aria-label="Search Rekordbox library" /><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter Rekordbox library"><option value="all">All tracks · {tracks.length}</option><option value="library">In Pipeline · {tracks.length - gapCount}</option><option value="gap">Library gaps · {gapCount}</option></select></div><div className="discovery-browser"><div className="rekordbox-table" role="table" aria-label="Rekordbox tracks"><div className="rekordbox-row rekordbox-header" role="row"><span>Artist</span><span>Title</span><span>BPM</span><span>Key</span><span>Status</span></div>{visibleTracks.map((track) => <button className={`rekordbox-row${selected && nameOf(selected) === nameOf(track) ? " selected" : ""}`} key={`${track.artist}-${track.title}-${track.location}`} onClick={() => { setSelected(track); setResults(null); }} role="row"><span title={track.artist}>{track.artist || "Unknown artist"}</span><span title={track.title}>{track.title}</span><span>{track.bpm ? Math.round(Number(track.bpm)) : "—"}</span><span>{track.key || "—"}</span><span className={track.inLibrary ? "status-known" : "status-gap"}>{track.inLibrary ? "In Pipeline" : "Library gap"}</span></button>)}{!visibleTracks.length && <div className="table-empty">No tracks match this search.</div>}</div><TrackDetail track={selected} adding={adding} onFindRelated={findRelated} onAdd={addToPipeline} /></div></>}
      {mode === "related" && <RelatedResults seed={selected} results={results} finding={finding} adding={adding} onBack={() => setMode("library")} onAdd={addToPipeline} />}
    </>}
  </div>;
}

function TrackDetail({ track, adding, onFindRelated, onAdd }: { track: RekordboxTrack | null; adding: boolean; onFindRelated: () => void; onAdd: (track: RekordboxTrack) => void }) {
  if (!track) return <aside className="track-detail empty-detail">Select a track to inspect it.</aside>;
  return <aside className="track-detail"><p className="detail-kicker">Selected track</p><h3>{nameOf(track)}</h3>{track.mixVersion && <p className="detail-mix">{track.mixVersion}</p>}<dl className="detail-grid"><dt>Album</dt><dd>{track.album || "—"}</dd><dt>Genre</dt><dd>{track.genre || "—"}</dd><dt>BPM</dt><dd>{track.bpm ? Math.round(Number(track.bpm)) : "—"}</dd><dt>Key</dt><dd>{track.key || "—"}</dd><dt>Playlists</dt><dd>{track.playlists.length ? track.playlists.join(" / ") : "—"}</dd><dt>Location</dt><dd title={track.location ?? undefined}>{track.location || "—"}</dd></dl><div className="detail-actions"><button className="button primary" onClick={onFindRelated}>Find related</button><button className="button secondary" disabled={track.inLibrary || adding} onClick={() => onAdd(track)}>{track.inLibrary ? "Already in Pipeline" : adding ? "Adding…" : "Add to Pipeline"}</button></div></aside>;
}

function RelatedResults({ seed, results, finding, adding, onBack, onAdd }: { seed: RekordboxTrack | null; results: SimilarTrack[] | null; finding: boolean; adding: boolean; onBack: () => void; onAdd: (track: SimilarTrack) => void }) {
  return <div className="related-view"><div className="related-heading"><div><p className="detail-kicker">Related music</p><h3>{seed ? nameOf(seed) : "Select a seed track"}</h3></div><button className="button secondary" onClick={onBack}>Back to library</button></div>{finding ? <div className="empty-state">Finding related tracks…</div> : results && <div className="similar-results">{results.map((track) => <div className="similar-row" key={track.cosineId}><div><strong>{nameOf(track)}</strong>{track.mixVersion && <small>{track.mixVersion}</small>}</div><span>{Math.round(track.score * 100)}%</span><button className="button secondary" disabled={adding} onClick={() => onAdd(track)}>Add to Pipeline</button></div>)}</div>}</div>;
}
