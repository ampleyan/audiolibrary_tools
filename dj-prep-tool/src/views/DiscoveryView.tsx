import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { SimilarPanel } from "./ReviewView";
import type { RekordboxTrack, SimilarTrack, TrackRow } from "../lib/types";

function nameOf(track: { artist: string; title: string }) {
  return track.artist ? `${track.artist} – ${track.title}` : track.title;
}

export default function DiscoveryView({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [mode, setMode] = useState("library");
  const [tracks, setTracks] = useState<RekordboxTrack[]>([]);
  const [xmlLoaded, setXmlLoaded] = useState(false);
  const [pipeline, setPipeline] = useState<TrackRow[]>([]);
  const [relatedSource, setRelatedSource] = useState("rekordbox");
  const [selected, setSelected] = useState<RekordboxTrack | null>(null);
  const [relatedSeed, setRelatedSeed] = useState<{ artist: string; title: string } | null>(null);
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
      const rows = await api.listTracks();
      setPipeline(rows);
      if (!refresh) return;
      if (!xmlPath) {
        throw new Error("Rekordbox XML not configured. Choose the XML file in Settings.");
      }
      const preview = await api.checkRekordbox(xmlPath);
      setTracks(preview.tracksInXml);
      setXmlLoaded(true);
      setSelected((current) => current && preview.tracksInXml.some((track) => nameOf(track) === nameOf(current)) ? current : preview.tracksInXml[0] ?? null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const inPipeline = (track: { artist: string; title: string }) => tracks.some((item) => nameOf(item) === nameOf(track) && item.inLibrary) || pipeline.some((item) => nameOf(item) === nameOf(track));

  const visibleTracks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tracks.filter((track) => {
      if (filter === "library" && !inPipeline(track)) return false;
      if (filter === "gap" && inPipeline(track)) return false;
      if (!needle) return true;
      return `${track.artist} ${track.title} ${track.album ?? ""} ${track.genre ?? ""} ${track.playlists.join(" ")}`.toLowerCase().includes(needle);
    });
  }, [filter, query, tracks]);

  const findRelated = async () => {
    if (!selected) return;
    await findRelatedFor(selected.artist, selected.title);
  };

  const findRelatedFor = async (artist: string, title: string) => {
    setFinding(true);
    setError(null);
    setMode("related");
    setRelatedSource("rekordbox");
    setRelatedSeed({ artist, title });
    try {
      setResults(await api.getSimilarTracksForQuery(artist, title));
    } catch (e) {
      setError(String(e));
    } finally {
      setFinding(false);
    }
  };

  const openPipelineRelated = () => {
    setRelatedSource("pipeline");
    setMode("related");
    setResults(null);
    setError(null);
  };

  const addToPipeline = async (track: { artist: string; title: string; mixVersion?: string | null }) => {
    setAdding(true);
    setError(null);
    try {
      const mix = track.mixVersion ? ` (${track.mixVersion})` : "";
      const rows = await api.importText(`${track.artist} - ${track.title}${mix}`);
      setPipeline((current) => [...current, ...rows]);
      if (selected && nameOf(selected) === nameOf(track)) setSelected({ ...selected, inLibrary: true });
      if (rows.length) setTracks((current) => current.map((item) => nameOf(item) === nameOf(track) ? { ...item, inLibrary: true } : item));
    } catch (e) {
      setError(String(e));
    } finally {
      setAdding(false);
    }
  };

  const gapCount = tracks.filter((track) => !inPipeline(track)).length;

  return <div className="view discovery-view">
    <div className="discovery-heading"><div className="view-heading"><h2>Discover</h2><p>Explore your Rekordbox library and find what belongs next.</p></div><button className="button secondary" onClick={() => load(true)} disabled={refreshing}>{refreshing ? "Loading…" : xmlLoaded ? "Refresh XML" : "Load XML"}</button></div>
    <div className="discovery-tabs" role="tablist" aria-label="Discovery modes"><button role="tab" aria-selected={mode === "library"} onClick={() => setMode("library")}>Rekordbox library</button><button role="tab" aria-selected={mode === "related"} onClick={() => { setMode("related"); setRelatedSource("pipeline"); }} disabled={!selected && !pipeline.length}>Related music</button></div>
    {pipeline.length > 0 && <div className="pipeline-seed"><label>Explore Pipeline tracks</label><span>Choose multiple seeds and build a playlist.</span><button className="button primary" onClick={openPipelineRelated}>Choose tracks</button></div>}
    {error && <div className="inline-error" role="alert"><span>{error}</span><button onClick={() => onNavigate("setup")}>Open Settings</button></div>}
    {loading ? <div className="empty-state">Loading Pipeline tracks…</div> : mode === "library" && !xmlLoaded && !error ? <div className="empty-state"><p>Rekordbox library is not loaded.</p><button className="button primary" onClick={() => load(true)}>Load XML</button></div> : !error && !tracks.length && mode !== "related" ? <div className="empty-state">No tracks were found in this Rekordbox XML.</div> : <>
      {mode === "library" && <><div className="discovery-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search artist, title, genre, playlist" aria-label="Search Rekordbox library" /><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter Rekordbox library"><option value="all">All tracks · {tracks.length}</option><option value="library">In Pipeline · {tracks.length - gapCount}</option><option value="gap">Library gaps · {gapCount}</option></select></div><div className="discovery-browser"><div className="rekordbox-table" role="table" aria-label="Rekordbox tracks"><div className="rekordbox-row rekordbox-header" role="row"><span>Artist</span><span>Title</span><span>BPM</span><span>Key</span><span>Status</span></div>{visibleTracks.map((track) => <button className={`rekordbox-row${selected && nameOf(selected) === nameOf(track) ? " selected" : ""}`} key={`${track.artist}-${track.title}-${track.location}`} onClick={() => { setSelected(track); setResults(null); }} role="row"><span title={track.artist}>{track.artist || "Unknown artist"}</span><span title={track.title}>{track.title}</span><span>{track.bpm ? Math.round(Number(track.bpm)) : "—"}</span><span>{track.key || "—"}</span><span className={track.inLibrary ? "status-known" : "status-gap"}>{track.inLibrary ? "In Pipeline" : "Library gap"}</span></button>)}{!visibleTracks.length && <div className="table-empty">No tracks match this search.</div>}</div><TrackDetail track={selected} adding={adding} onFindRelated={findRelated} onAdd={addToPipeline} /></div></>}
      {mode === "related" && (relatedSource === "pipeline" ? <SimilarPanel tracks={pipeline} onOpenLibrary={() => onNavigate("library")} /> : <RelatedResults seed={relatedSeed} results={results} finding={finding} adding={adding} onBack={() => setMode("library")} onAdd={addToPipeline} />)}
    </>}
  </div>;
}

function TrackDetail({ track, adding, onFindRelated, onAdd }: { track: RekordboxTrack | null; adding: boolean; onFindRelated: () => void; onAdd: (track: RekordboxTrack) => void }) {
  if (!track) return <aside className="track-detail empty-detail">Select a track to inspect it.</aside>;
  return <aside className="track-detail"><p className="detail-kicker">Selected track</p><h3>{nameOf(track)}</h3>{track.mixVersion && <p className="detail-mix">{track.mixVersion}</p>}<dl className="detail-grid"><dt>Album</dt><dd>{track.album || "—"}</dd><dt>Genre</dt><dd>{track.genre || "—"}</dd><dt>BPM</dt><dd>{track.bpm ? Math.round(Number(track.bpm)) : "—"}</dd><dt>Key</dt><dd>{track.key || "—"}</dd><dt>Playlists</dt><dd>{track.playlists.length ? track.playlists.join(" / ") : "—"}</dd><dt>Location</dt><dd title={track.location ?? undefined}>{track.location || "—"}</dd></dl><div className="detail-actions"><button className="button primary" onClick={onFindRelated}>Find related</button><button className="button secondary" disabled={track.inLibrary || adding} onClick={() => onAdd(track)}>{track.inLibrary ? "Already in Pipeline" : adding ? "Adding…" : "Add to Pipeline"}</button></div></aside>;
}

function RelatedResults({ seed, results, finding, adding, onBack, onAdd }: { seed: { artist: string; title: string } | null; results: SimilarTrack[] | null; finding: boolean; adding: boolean; onBack: () => void; onAdd: (track: SimilarTrack) => void }) {
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [creatingYoutube, setCreatingYoutube] = useState(false);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [youtubeResult, setYoutubeResult] = useState<{ playlistUrl: string; added: number; skipped: string[] } | null>(null);
  const visibleTracks = results ?? [];
  const getVideoId = (url: string) => url.match(/[?&]v=([^&]+)/)?.[1] ?? url.match(/youtu\.be\/([^?]+)/)?.[1] ?? null;
  const selectedTracks = [...selectedRows].sort((a, b) => a - b).map((index) => visibleTracks[index]).filter((track): track is SimilarTrack => !!track);
  const playlistTracks = selectedTracks.length ? selectedTracks : visibleTracks;

  const toggleRow = (index: number) => {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const createYoutubePlaylist = async () => {
    const skipped = playlistTracks.filter((track) => !track.videoUrl).map((track) => nameOf(track));
    const videoIds = playlistTracks.map((track) => track.videoUrl ? getVideoId(track.videoUrl) : null).filter((id): id is string => !!id);
    if (!videoIds.length) {
      setYoutubeError("No selected tracks have YouTube videos");
      return;
    }
    setCreatingYoutube(true);
    setYoutubeError(null);
    setYoutubeResult(null);
    try {
      const auth = await api.getYoutubeAuthUrl();
      if (!auth.authorized && auth.url) {
        window.location.assign(auth.url);
        return;
      }
      setYoutubeResult(await api.createYoutubePlaylist(videoIds, `DJ Prep – ${seed?.title ?? "Related tracks"}`, skipped));
    } catch (e) {
      setYoutubeError(String(e));
    } finally {
      setCreatingYoutube(false);
    }
  };

  return <div className="related-view"><div className="related-heading"><div><p className="detail-kicker">Related music</p><h3>{seed ? nameOf(seed) : "Select a seed track"}</h3></div><button className="button secondary" onClick={onBack}>Back to library</button></div>{finding ? <div className="empty-state">Finding related tracks…</div> : results && <><div className="related-actions"><span>{visibleTracks.length} tracks{selectedRows.size > 0 && ` · ${selectedRows.size} selected`}</span><button className="button secondary" onClick={() => setSelectedRows(selectedRows.size === visibleTracks.length ? new Set() : new Set(visibleTracks.map((_, index) => index)))}>{selectedRows.size === visibleTracks.length ? "Clear selection" : "Select all"}</button><button className="button primary" onClick={createYoutubePlaylist} disabled={creatingYoutube}>{creatingYoutube ? "Connecting…" : selectedRows.size ? "Create playlist from selection" : "Create YouTube playlist"}</button></div>{youtubeError && <p className="youtube-message error">{youtubeError}</p>}{youtubeResult && <p className="youtube-message success">Created playlist with {youtubeResult.added} tracks. <a href={youtubeResult.playlistUrl} target="_blank" rel="noreferrer">Open YouTube playlist</a>{youtubeResult.skipped.length > 0 && ` · Skipped ${youtubeResult.skipped.length}`}</p>}<div className="similar-results">{visibleTracks.map((track, index) => { const videoId = track.videoUrl ? getVideoId(track.videoUrl) : null; const isPlaying = playingIndex === index; return <div className={`similar-row${selectedRows.has(index) ? " selected" : ""}`} key={track.cosineId}><input type="checkbox" checked={selectedRows.has(index)} onChange={() => toggleRow(index)} aria-label={`Select ${nameOf(track)}`} /><div><strong>{nameOf(track)}</strong>{track.mixVersion && <small>{track.mixVersion}</small>}</div><span>{Math.round(track.score * 100)}%</span>{videoId && <button className="button listen" onClick={() => setPlayingIndex(isPlaying ? null : index)}>{isPlaying ? "Stop" : "Listen"}</button>}<button className="button secondary" disabled={adding} onClick={() => onAdd(track)}>Add to Pipeline</button>{isPlaying && videoId && <iframe title={`Preview ${nameOf(track)}`} src={`https://www.youtube.com/embed/${videoId}?autoplay=1`} allow="autoplay; encrypted-media" />}</div>; })}</div></>}</div>;
}
