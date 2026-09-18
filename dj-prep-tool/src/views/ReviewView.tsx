import { useEffect, useState } from "react";
import { api, WORKBENCH_DATA_CHANGED_EVENT } from "../lib/api";
import type { CosineFilters, RankedCandidate, SimilarTrack, TrackRow, TrackState } from "../lib/types";
import { PipelineSeedListbox } from "../components/PipelineSeedListbox";

function parseCandidates(track: TrackRow): RankedCandidate[] {
  if (!track.candidate_json) return [];
  try {
    return JSON.parse(track.candidate_json);
  } catch {
    return [];
  }
}

const editInput: React.CSSProperties = {
  background: "#111827",
  border: "1px solid #374151",
  borderRadius: 3,
  color: "#f9fafb",
  padding: "3px 8px",
  fontSize: 13,
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};

const DEFAULT_REVIEW_STATES: TrackState[] = ["requested", "needs_review", "matched", "not_found"];

export const DEFAULT_COSINE_FILTERS: CosineFilters = {
  yearStart: 1950,
  yearEnd: 2026,
  minHave: 0,
  maxHave: 10000,
  minWant: 0,
  maxWant: 5000,
  minPrice: 0,
  maxPrice: 500,
};

const COSINE_PAGE_SIZE = 20;

function similarLibraryKey(artist: string, title: string, mixVersion?: string | null) {
  return [artist, title, mixVersion ?? ""].map((value) => value.trim().replace(/\s+/g, " ").toLowerCase()).join("\u0000");
}

export function CosineFiltersForm({ filters, onChange, onApply, onReset, disabled = false }: { filters: CosineFilters; onChange: (filters: CosineFilters) => void; onApply: () => void; onReset: () => void; disabled?: boolean }) {
  const fields: Array<[keyof CosineFilters, string]> = [
    ["yearStart", "Year start"],
    ["yearEnd", "Year end"],
    ["minHave", "Have min"],
    ["maxHave", "Have max"],
    ["minWant", "Want min"],
    ["maxWant", "Want max"],
    ["minPrice", "Price min ($)"],
    ["maxPrice", "Price max ($)"],
  ];
  const update = (key: keyof CosineFilters, value: string) => onChange({ ...filters, [key]: value === "" ? undefined : Number(value) });
  return <details open style={{ marginTop: 10 }}>
    <summary style={{ color: "#9ca3af", fontSize: 11, cursor: "pointer" }}>Cosine filters</summary>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, marginTop: 8 }}>
      {fields.map(([key, label]) => <label key={key} style={{ color: "#6b7280", fontSize: 10 }}>{label}<input type="number" value={filters[key] ?? ""} onChange={(event) => update(key, event.target.value)} disabled={disabled} style={{ ...editInput, marginTop: 2 }} /></label>)}
    </div>
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <button onClick={onApply} disabled={disabled} style={{ background: "#1e3a5f", color: "#93c5fd", border: "1px solid #1e40af", borderRadius: 4, padding: "3px 8px", fontSize: 11, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit" }}>Apply filters</button>
      <button onClick={onReset} disabled={disabled} style={{ background: "transparent", color: "#6b7280", border: "1px solid #374151", borderRadius: 4, padding: "3px 8px", fontSize: 11, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit" }}>Reset</button>
    </div>
  </details>;
}

export function SimilarPanel({ tracks, onOpenLibrary, onPlayTrack }: { tracks: TrackRow[]; onOpenLibrary?: () => void; onPlayTrack: (tracks: SimilarTrack[], index: number) => void }) {
  const [sourceIds, setSourceIds] = useState<number[]>(tracks[0] ? [tracks[0].id] : []);
  const [similarTracks, setSimilarTracks] = useState<SimilarTrack[] | null>(null);
  const [similarPage, setSimilarPage] = useState(1);
  const [hasMoreSimilar, setHasMoreSimilar] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [maxResults, setMaxResults] = useState(100);
  const [minimumScore, setMinimumScore] = useState(0);
  const [cosineFilters, setCosineFilters] = useState<CosineFilters>(DEFAULT_COSINE_FILTERS);
  const [sourceProgress, setSourceProgress] = useState<string | null>(null);
  const [sourceLabels, setSourceLabels] = useState<Record<string, string[]>>({});
  const [youtubeResult, setYoutubeResult] = useState<{ playlistUrl: string; added: number; skipped: string[] } | null>(null);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [creatingYoutube, setCreatingYoutube] = useState(false);
  const [showExisting, setShowExisting] = useState(false);

  const getVideoId = (url: string) => url.match(/[?&]v=([^&]+)/)?.[1] ?? null;
  const selectedSources = tracks.filter((track) => sourceIds.includes(track.id));
  const selectedTrack = selectedSources[0] ?? tracks[0];
  const existingKeys = new Set(tracks.map((track) => similarLibraryKey(track.artist, track.title, track.mix_version)));
  const existingTrack = (track: SimilarTrack) => existingKeys.has(similarLibraryKey(track.artist, track.title, track.mixVersion));
  const existingCount = similarTracks?.filter(existingTrack).length ?? 0;
  const visibleTracks = similarTracks
    ?.filter((track) => track.score >= minimumScore && (showExisting || !existingTrack(track)))
    .slice(0, maxResults);

  useEffect(() => {
    const validIds = sourceIds.filter((id) => tracks.some((track) => track.id === id));
    if (validIds.length !== sourceIds.length) {
      setSourceIds(validIds.length > 0 ? validIds : tracks[0] ? [tracks[0].id] : []);
    }
  }, [tracks, sourceIds]);

  useEffect(() => {
    setSelected(new Set());
    setSimilarPage(1);
    setHasMoreSimilar(false);
  }, [maxResults, minimumScore]);

  const load = async () => {
    if (selectedSources.length === 0) return;
    setLoading(true);
    setError(null);
    setImportedCount(null);
    setSimilarTracks(null);
    setSourceLabels({});
    setSelected(new Set());
    setSimilarPage(1);
    setHasMoreSimilar(false);
    try {
      const combined = new Map<string, SimilarTrack>();
      const labels: Record<string, string[]> = {};
      const failures: string[] = [];
      for (const [index, source] of selectedSources.entries()) {
        setSourceProgress(`${index + 1}/${selectedSources.length}`);
        try {
          const results = await api.getSimilarTracks(source.id, { ...cosineFilters, page: 1, limit: COSINE_PAGE_SIZE });
          if (results.length === COSINE_PAGE_SIZE) setHasMoreSimilar(true);
          for (const result of results) {
            const key = result.cosineId || `${result.artist}\u0000${result.title}`;
            combined.set(key, combined.get(key) ?? result);
            labels[key] = [...(labels[key] ?? []), source.artist ? `${source.artist} – ${source.title}` : source.title];
          }
        } catch {
          failures.push(source.artist ? `${source.artist} – ${source.title}` : source.title);
        }
      }
      setSourceLabels(labels);
      setSimilarTracks([...combined.values()]);
      if (failures.length > 0) setError(`Could not load: ${failures.join(", ")}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setSourceProgress(null);
    }
  };

  const loadMore = async () => {
    if (selectedSources.length === 0 || !similarTracks || loadingMore || !hasMoreSimilar) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = similarPage + 1;
      const combined = new Map<string, SimilarTrack>(similarTracks.map((track) => [track.cosineId || `${track.artist}\u0000${track.title}`, track]));
      const labels = { ...sourceLabels };
      let receivedPage = false;
      for (const source of selectedSources) {
        const results = await api.getSimilarTracks(source.id, { ...cosineFilters, page, limit: COSINE_PAGE_SIZE });
        if (results.length === COSINE_PAGE_SIZE) receivedPage = true;
        for (const result of results) {
          const key = result.cosineId || `${result.artist}\u0000${result.title}`;
          combined.set(key, combined.get(key) ?? result);
          labels[key] = [...(labels[key] ?? []), source.artist ? `${source.artist} – ${source.title}` : source.title];
        }
      }
      setSimilarTracks([...combined.values()]);
      setSourceLabels(labels);
      setSimilarPage(page);
      setHasMoreSimilar(receivedPage);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleSelect = (index: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const addToQueue = async () => {
    if (!similarTracks || selected.size === 0) return;
    setImporting(true);
    setImportError(null);
    setImportedCount(null);
    try {
      const text = [...selected]
        .sort((a, b) => a - b)
        .map((index) => {
          const track = visibleTracks?.[index];
          return track ? (track.mixVersion ? `${track.artist} - ${track.title} (${track.mixVersion})` : `${track.artist} - ${track.title}`) : null;
        })
        .filter((line): line is string => line !== null)
        .join("\n");
      const added = await api.importText(text);
      setSelected(new Set());
      setImportedCount(added.length);
    } catch (e) {
      setImportError(String(e));
    } finally {
      setImporting(false);
    }
  };

  const savePlaylist = () => {
    if (!similarTracks) return;
    const targets = selected.size > 0
      ? [...selected].sort((a, b) => a - b).map((index) => visibleTracks?.[index]).filter((track): track is SimilarTrack => !!track)
      : visibleTracks ?? [];
    const lines = targets.map((track) =>
      track.mixVersion ? `${track.artist} - ${track.title} (${track.mixVersion})` : `${track.artist} - ${track.title}`
    );
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `similar-${selectedTrack?.artist ?? "tracks"}.txt`.replace(/[\\/:*?"<>|]/g, "_");
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const createYoutubePlaylist = async () => {
    if (!visibleTracks) return;
    const targets = selected.size > 0
      ? [...selected].sort((a, b) => a - b).map((index) => visibleTracks[index]).filter((track): track is SimilarTrack => !!track)
      : visibleTracks;
    const skipped = targets.filter((track) => !track.videoUrl).map((track) => `${track.artist} – ${track.title}`);
    const videoIds = targets.map((track) => track.videoUrl ? getVideoId(track.videoUrl) : null).filter((id): id is string => !!id);
    if (videoIds.length === 0) {
      setYoutubeError("No selected tracks have YouTube videos");
      return;
    }
    setCreatingYoutube(true);
    setYoutubeError(null);
    try {
      const auth = await api.getYoutubeAuthUrl();
      if (!auth.authorized && auth.url) {
        window.location.assign(auth.url);
        return;
      }
      setYoutubeResult(await api.createYoutubePlaylist(videoIds, `DJ Prep – ${selectedTrack?.title ?? "Similar tracks"}`, skipped));
    } catch (e) {
      setYoutubeError(String(e));
    } finally {
      setCreatingYoutube(false);
    }
  };

  return (
    <section className="similar-panel" style={{ background: "#111827", border: "1px solid #293548", borderRadius: 8, marginBottom: 18, padding: 16 }}>
      <div className="similar-panel-layout">
        <aside className="similar-seed-column">
          <PipelineSeedListbox tracks={tracks} selectedIds={sourceIds} onChange={(ids) => {
            setSourceIds(ids);
            setSimilarTracks(null);
            setSourceLabels({});
            setSelected(new Set());
            setSimilarPage(1);
            setHasMoreSimilar(false);
            setError(null);
          }} />
          <button onClick={load} disabled={selectedSources.length === 0 || loading} style={{ background: loading ? "#1f2937" : "#4c1d95", color: loading ? "#4b5563" : "#ddd6fe", border: "1px solid #6d28d9", borderRadius: 5, padding: "6px 12px", fontSize: 12, cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
            {loading ? `Finding ${sourceProgress ?? "…"}` : similarTracks ? "Refresh" : "Find similar"}
          </button>
          <CosineFiltersForm filters={cosineFilters} onChange={setCosineFilters} onApply={load} onReset={() => setCosineFilters(DEFAULT_COSINE_FILTERS)} disabled={loading} />
        </aside>
        <div className="similar-results-column">
          {error && <p style={{ color: "#f87171", fontSize: 12, margin: "0 0 8px" }}>{error}</p>}
          {importError && <p style={{ color: "#f87171", fontSize: 12, margin: "0 0 8px" }}>{importError}</p>}
          {importedCount !== null && <p aria-live="polite" style={{ color: "#34d399", fontSize: 12, margin: "0 0 8px" }}>Added {importedCount} track{importedCount === 1 ? "" : "s"} to Library.{onOpenLibrary && <button onClick={onOpenLibrary} style={{ background: "transparent", color: "#93c5fd", border: "1px solid #1e40af", borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer", fontFamily: "inherit", marginLeft: 8 }}>View Library</button>}</p>}
          {youtubeError && <p style={{ color: "#f87171", fontSize: 12, margin: "0 0 8px" }}>{youtubeError}</p>}
          {youtubeResult && <p style={{ color: "#34d399", fontSize: 12, margin: "0 0 8px" }}>Created playlist with {youtubeResult.added} tracks. <a href={youtubeResult.playlistUrl} target="_blank" rel="noreferrer" style={{ color: "#60a5fa" }}>Open YouTube playlist</a>{youtubeResult.skipped.length > 0 && ` · Skipped ${youtubeResult.skipped.length} unavailable or rejected`}</p>}
          {similarTracks !== null && (
            <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ color: "#6b7280", fontSize: 11 }}>{visibleTracks?.length ?? 0} of {similarTracks.length} recommendations{existingCount > 0 && ` · ${existingCount} already in library`}{selected.size > 0 && <span style={{ color: "#a78bfa" }}> · {selected.size} selected</span>}</span>
            <div style={{ display: "flex", gap: 6 }}>
              {selected.size > 0 && <button onClick={addToQueue} disabled={importing} style={{ background: importing ? "#1f2937" : "#065f46", color: importing ? "#4b5563" : "#34d399", border: "none", borderRadius: 4, padding: "3px 10px", fontSize: 11, cursor: importing ? "not-allowed" : "pointer", fontFamily: "inherit" }}>{importing ? "Adding…" : `Add ${selected.size} to Library`}</button>}
              <button onClick={() => setSelected(selected.size === (visibleTracks?.length ?? 0) ? new Set() : new Set((visibleTracks ?? []).map((_, index) => index)))} disabled={!visibleTracks?.length} style={{ background: "transparent", color: "#a78bfa", border: "1px solid #4c1d95", borderRadius: 4, padding: "3px 10px", fontSize: 11, cursor: visibleTracks?.length ? "pointer" : "not-allowed", fontFamily: "inherit" }}>{selected.size === (visibleTracks?.length ?? 0) && (visibleTracks?.length ?? 0) > 0 ? "Clear selection" : "Select all recommendations"}</button>
              {existingCount > 0 && <button onClick={() => { setShowExisting((current) => !current); setSelected(new Set()); }} style={{ background: "transparent", color: "#9ca3af", border: "1px solid #374151", borderRadius: 4, padding: "3px 10px", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>{showExisting ? `Hide existing (${existingCount})` : `Show existing (${existingCount})`}</button>}
              {(visibleTracks?.filter((t) => t.videoUrl).length ?? 0) > 0 && <button onClick={() => { const playable = visibleTracks?.filter((t) => t.videoUrl) ?? []; onPlayTrack(playable, 0); }} style={{ background: "#1e3a5f", color: "#60a5fa", border: "1px solid #1e40af", borderRadius: 4, padding: "3px 10px", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>▶ Play all</button>}
              <button onClick={savePlaylist} style={{ background: "transparent", color: "#6b7280", border: "1px solid #374151", borderRadius: 4, padding: "3px 10px", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>{selected.size > 0 ? `Download ${selected.size}` : "Download all"} as text playlist</button>
              <button onClick={createYoutubePlaylist} disabled={creatingYoutube} title="Create a private YouTube playlist" style={{ background: "transparent", color: creatingYoutube ? "#4b5563" : "#9ca3af", border: "1px solid #374151", borderRadius: 4, padding: "3px 10px", fontSize: 11, cursor: creatingYoutube ? "not-allowed" : "pointer", fontFamily: "inherit" }}>{creatingYoutube ? "Connecting…" : "Create YouTube playlist"}</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
            <label style={{ color: "#6b7280", fontSize: 11 }}>
              Show
              <select value={maxResults} onChange={(event) => setMaxResults(Number(event.target.value))} style={{ ...editInput, width: 72, marginLeft: 6 }} aria-label="Maximum similar tracks">
                {[10, 25, 50, 100].map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
            <label style={{ color: "#6b7280", fontSize: 11 }}>
              Minimum score
              <input type="number" min="0" max="1" step="0.05" value={minimumScore} onChange={(event) => setMinimumScore(Math.min(1, Math.max(0, Number(event.target.value) || 0)))} style={{ ...editInput, width: 64, marginLeft: 6 }} aria-label="Minimum similarity score" />
            </label>
            {visibleTracks?.length === 0 && <span style={{ color: "#f59e0b", fontSize: 11 }}>No tracks match these filters.</span>}
          </div>
          <div className="similar-results-list" aria-label="Similar track recommendations">
            {visibleTracks?.map((track, index) => {
              const videoId = track.videoUrl ? getVideoId(track.videoUrl) : null;
              const key = track.cosineId || `${track.artist}\u0000${track.title}`;
              const isInLibrary = existingTrack(track);
              return <div key={`${track.cosineId}-${index}`} className={`similar-result-row${isInLibrary ? " is-in-library" : ""}`}>
                <input type="checkbox" checked={selected.has(index)} onChange={() => toggleSelect(index)} disabled={isInLibrary} aria-label={`Select ${track.artist} ${track.title}`} />
                <div className="similar-result-main">
                  <strong title={`${track.artist} – ${track.title}`}>{track.artist} – {track.title}</strong>
                  <div className="similar-result-meta">
                    {track.mixVersion && <span>{track.mixVersion}</span>}
                    <span>{sourceLabels[key]?.length ? `From ${sourceLabels[key].join(", ")}` : "Recommendation"}</span>
                    {isInLibrary && <span className="similar-result-library">Already in library</span>}
                  </div>
                </div>
                <span className="similar-result-score" title={`Cosine score ${track.score.toFixed(3)}`}>
                  {(track.score * 100).toFixed(0)}%
                  <small>{track.score.toFixed(3)}</small>
                </span>
                <div className="similar-result-action">
                  {videoId ? <button onClick={() => onPlayTrack(visibleTracks ?? [], index)} aria-label={`Play preview for ${track.artist} ${track.title}`}>▶ Listen</button> : <span>No preview</span>}
                </div>
              </div>;
            })}
          </div>
          {hasMoreSimilar && <button onClick={loadMore} disabled={loadingMore} style={{ width: "100%", marginTop: 8, background: "transparent", color: "#a78bfa", border: "1px solid #4c1d95", borderRadius: 4, padding: "5px 10px", fontSize: 11, cursor: loadingMore ? "not-allowed" : "pointer", fontFamily: "inherit" }}>{loadingMore ? "Loading more…" : `Load more recommendations (${COSINE_PAGE_SIZE})`}</button>}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function TrackCard({
  track,
  onRefresh,
  onDelete,
}: {
  track: TrackRow;
  onRefresh: () => Promise<void>;
  onDelete: (id: number) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editArtist, setEditArtist] = useState(track.artist);
  const [editTitle, setEditTitle] = useState(track.title);
  const [editMix, setEditMix] = useState(track.mix_version ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const candidates = parseCandidates(track);

  const search = async () => {
    setSearching(true);
    setErr(null);
    try {
      await api.searchTrack(track.id);
      await onRefresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSearching(false);
    }
  };

  const searchLoose = async () => {
    setSearching(true);
    setErr(null);
    try {
      await api.searchTrackLoose(track.id);
      await onRefresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSearching(false);
    }
  };

  const saveEdit = async () => {
    setSaving(true);
    setErr(null);
    try {
      await api.updateTrack(track.id, editArtist.trim(), editTitle.trim(), editMix.trim() || null);
      setEditing(false);
      onRefresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  const deleteTrack = async () => {
    setDeleting(true);
    try {
      await api.deleteTrack(track.id);
      onDelete(track.id);
    } catch (e) {
      setErr(String(e));
      setDeleting(false);
    }
  };

  const markNotFound = async () => {
    setSearching(true);
    setErr(null);
    try {
      await api.updateTrackState(track.id, "not_found");
      onRefresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSearching(false);
    }
  };

  const noResults = track.state === "requested" && !!track.search_job_id;
  const canSearch = track.state === "requested" || track.state === "needs_review" || track.state === "not_found";
  const isMatched = track.state === "matched";
  const needsReview = track.state === "needs_review";

  return (
    <div
      className={searching ? "track-searching" : undefined}
      style={{
        background: "#1f2937",
        borderRadius: 6,
        marginBottom: 10,
        overflow: "hidden",
        opacity: deleting ? 0.4 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "10px 14px",
          gap: 10,
        }}
      >
        {editing ? (
          <div style={{ flex: 1, display: "flex", gap: 8 }}>
            <div style={{ flex: 2 }}>
              <input
                style={editInput}
                value={editArtist}
                onChange={(e) => setEditArtist(e.target.value)}
                placeholder="Artist"
              />
            </div>
            <div style={{ flex: 3 }}>
              <input
                style={editInput}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Title"
              />
            </div>
            <div style={{ flex: 2 }}>
              <input
                style={editInput}
                value={editMix}
                onChange={(e) => setEditMix(e.target.value)}
                placeholder="Mix version (optional)"
              />
            </div>
          </div>
        ) : (
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 14, color: "#e5e7eb", fontWeight: 500 }}>
              {track.artist ? `${track.artist} – ${track.title}` : track.title}
            </span>
            {track.mix_version && (
              <span style={{ fontSize: 12, color: "#6b7280", marginLeft: 8 }}>
                {track.mix_version}
              </span>
            )}
          </div>
        )}

        <span
          style={{
            fontSize: 10,
            color: noResults ? "#f87171" : needsReview ? "#fb923c" : "#6b7280",
            flexShrink: 0,
          }}
        >
          {noResults ? "no results" : track.state.replace(/_/g, " ")}
        </span>

        {editing ? (
          <>
            <button
              onClick={saveEdit}
              disabled={saving}
              style={{
                background: "#065f46",
                color: "#34d399",
                border: "none",
                borderRadius: 4,
                padding: "4px 12px",
                fontSize: 12,
                cursor: saving ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                flexShrink: 0,
              }}
            >
              {saving ? "…" : "Save"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setEditArtist(track.artist);
                setEditTitle(track.title);
                setEditMix(track.mix_version ?? "");
              }}
              style={{
                background: "transparent",
                color: "#6b7280",
                border: "none",
                borderRadius: 4,
                padding: "4px 8px",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
                flexShrink: 0,
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {(canSearch || needsReview) && (
              <button
                onClick={() => {
                  setEditing(true);
                  setEditArtist(track.artist);
                  setEditTitle(track.title);
                  setEditMix(track.mix_version ?? "");
                }}
                style={{
                  background: "transparent",
                  color: "#6b7280",
                  border: "1px solid #374151",
                  borderRadius: 4,
                  padding: "4px 10px",
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  flexShrink: 0,
                }}
              >
                Edit query
              </button>
            )}
            {canSearch && (
              <button
                onClick={search}
                disabled={searching}
                style={{
                  background: searching ? "#1f2937" : "#1e3a5f",
                  color: searching ? "#4b5563" : "#60a5fa",
                  border: "1px solid #1e40af",
                  borderRadius: 4,
                  padding: "4px 12px",
                  fontSize: 12,
                  cursor: searching ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  flexShrink: 0,
                }}
              >
                {searching ? "Searching…" : noResults ? "Search again" : "Search"}
              </button>
            )}
            {noResults && (
              <button
                onClick={searchLoose}
                disabled={searching}
                style={{
                  background: searching ? "#1f2937" : "#1e3a5f",
                  color: searching ? "#4b5563" : "#60a5fa",
                  border: "1px solid #1e40af",
                  borderRadius: 4,
                  padding: "4px 12px",
                  fontSize: 12,
                  cursor: searching ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  flexShrink: 0,
                }}
              >
                {searching ? "Searching…" : "Loose search"}
              </button>
            )}
            {noResults && (
              <button
                onClick={markNotFound}
                disabled={searching}
                style={{
                  background: "transparent",
                  color: searching ? "#4b5563" : "#d1d5db",
                  border: "1px solid #4b5563",
                  borderRadius: 4,
                  padding: "4px 10px",
                  fontSize: 12,
                  cursor: searching ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  flexShrink: 0,
                }}
              >
                Mark unavailable
              </button>
            )}
            <button
              onClick={deleteTrack}
              disabled={deleting}
              style={{
                background: "transparent",
                border: "none",
                color: "#374151",
                cursor: deleting ? "not-allowed" : "pointer",
                fontSize: 14,
                padding: "2px 4px",
                fontFamily: "inherit",
                flexShrink: 0,
              }}
              title="Delete track"
            >
              ✕
            </button>
          </>
        )}
      </div>

      {searching && (
        <div style={{ borderTop: "1px solid #1e3a5f", padding: "7px 14px", background: "#0f1e38", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#60a5fa" }}>
          <span className="search-spinner" />
          Searching Soulseek… this takes ~30 seconds
        </div>
      )}

      {noResults && !editing && (
        <div
          style={{
            borderTop: "1px solid #111827",
            padding: "8px 14px",
            fontSize: 12,
            color: "#6b7280",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ color: "#f87171" }}>No results found.</span>
          <span>Loose search combines artist and title into a broader query. You can also edit the query, search again, or mark the track unavailable.</span>
        </div>
      )}

      {isMatched && candidates.length > 0 && (
        <div style={{ borderTop: "1px solid #064e3b", borderBottom: "1px solid #064e3b", background: "#062e2b", padding: "9px 14px", color: "#6ee7b7", fontSize: 12 }}>
          {candidates.length} candidate{candidates.length === 1 ? "" : "s"} found. Compare file facts and choose Approve &amp; next in the inspector.
        </div>
      )}

      {err && (
        <p style={{ color: "#f87171", fontSize: 12, padding: "0 14px 10px" }}>
          {err}
        </p>
      )}

    </div>
  );
}

export default function ReviewView({ states = DEFAULT_REVIEW_STATES, onTrackChanged }: { states?: TrackState[]; onTrackChanged?: (track: TrackRow) => void }) {
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchingAll, setSearchingAll] = useState(false);
  const [searchProgress, setSearchProgress] = useState<{ done: number; total: number } | null>(null);
  const [searchBatchErrors, setSearchBatchErrors] = useState<string[]>([]);
  const [approvingAll, setApprovingAll] = useState(false);
  const [approvalProgress, setApprovalProgress] = useState<{ done: number; total: number } | null>(null);
  const [approvalErrors, setApprovalErrors] = useState<string[]>([]);

  const load = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const results = await Promise.all(states.map((state) => api.listTracks(state)));
      setTracks(results.flat());
    } catch {
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [states]);
  useEffect(() => {
    const handleDataChanged = () => { void load(false); };
    window.addEventListener(WORKBENCH_DATA_CHANGED_EVENT, handleDataChanged);
    return () => window.removeEventListener(WORKBENCH_DATA_CHANGED_EVENT, handleDataChanged);
  }, [states]);

  const removeTrack = (id: number) =>
    setTracks((prev) => prev.filter((t) => t.id !== id));

  const searchAll = async (loose = false) => {
    const searchable = tracks.filter((t) => loose
      ? t.state === "requested" && !!t.search_job_id
      : t.state === "requested" || t.state === "needs_review");
    if (searchable.length === 0) return;
    setSearchingAll(true);
    setSearchBatchErrors([]);
    setSearchProgress({ done: 0, total: searchable.length });
    const failures: string[] = [];
    for (let i = 0; i < searchable.length; i++) {
      try {
        if (loose) await api.searchTrackLoose(searchable[i].id);
        else await api.searchTrack(searchable[i].id);
      } catch (e) {
        failures.push(`${searchable[i].artist} – ${searchable[i].title}: ${String(e)}`);
      }
      await load(false);
      setSearchProgress({ done: i + 1, total: searchable.length });
    }
    setSearchingAll(false);
    setSearchProgress(null);
    setSearchBatchErrors(failures);
    await load(false);
  };

  const searchableCount = tracks.filter(
    (t) => t.state === "requested" || t.state === "needs_review"
  ).length;
  const looseSearchCount = tracks.filter((t) => t.state === "requested" && !!t.search_job_id).length;
  const approveableTracks = tracks.filter((track) => track.state === "matched" && parseCandidates(track).length > 0);

  const approveAll = async () => {
    if (approveableTracks.length === 0) return;
    setApprovingAll(true);
    setApprovalErrors([]);
    setApprovalProgress({ done: 0, total: approveableTracks.length });
    const failures: string[] = [];
    for (let i = 0; i < approveableTracks.length; i++) {
      const track = approveableTracks[i];
      const best = [...parseCandidates(track)].sort((a, b) => b.score - a.score)[0];
      try {
        await api.approveCandidate(track.id, best.candidate.username, best.candidate.filename);
        onTrackChanged?.({ ...track, state: "approved", selected_username: best.candidate.username, selected_filename: best.candidate.filename });
      } catch (e) {
        failures.push(`${track.artist} – ${track.title}: ${String(e)}`);
      }
      await load(false);
      setApprovalProgress({ done: i + 1, total: approveableTracks.length });
    }
    setApprovingAll(false);
    setApprovalProgress(null);
    setApprovalErrors(failures);
    await load(false);
  };

  return (
    <div className="view review-view" style={{ padding: 24, color: "#f9fafb" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div className="view-heading">
          <h2>Choose the right match</h2>
          <p>Search Soulseek, compare candidates, and approve the file you want.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {searchProgress && (
            <div className="search-batch-progress">
              <span className="search-spinner" />
              <span>{searchProgress.done} / {searchProgress.total}</span>
              <div className="search-batch-bar">
                <div className="search-batch-fill" style={{ width: `${Math.round((searchProgress.done / searchProgress.total) * 100)}%` }} />
              </div>
              <span style={{ color: "#6b7280" }}>searching…</span>
            </div>
          )}
          {approvalProgress && (
            <div className="search-batch-progress" style={{ borderColor: "#047857", background: "#052e1c", color: "#34d399" }}>
              <span>{approvalProgress.done} / {approvalProgress.total}</span>
              <div className="search-batch-bar">
                <div className="search-batch-fill" style={{ width: `${Math.round((approvalProgress.done / approvalProgress.total) * 100)}%`, background: "#22c55e" }} />
              </div>
              <span style={{ color: "#6b7280" }}>approving…</span>
            </div>
          )}
          {approveableTracks.length > 0 && (
            <button
              onClick={() => void approveAll()}
              disabled={searchingAll || approvingAll}
              style={{ background: searchingAll || approvingAll ? "#1f2937" : "#065f46", color: searchingAll || approvingAll ? "#4b5563" : "#34d399", border: "1px solid #047857", borderRadius: 5, padding: "6px 14px", fontSize: 13, cursor: searchingAll || approvingAll ? "not-allowed" : "pointer", fontFamily: "inherit" }}
            >
              {approvingAll ? "Approving…" : `Approve all (${approveableTracks.length})`}
            </button>
          )}
          {searchableCount > 0 && (
            <button
              onClick={() => searchAll()}
              disabled={searchingAll || approvingAll}
              style={{
                background: searchingAll ? "#1f2937" : "#1e3a5f",
                color: searchingAll ? "#4b5563" : "#60a5fa",
                border: "1px solid #1e40af",
                borderRadius: 5,
                padding: "6px 14px",
                fontSize: 13,
                cursor: searchingAll ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {searchingAll ? "Searching…" : `Search all (${searchableCount})`}
            </button>
          )}
          {looseSearchCount > 0 && (
            <button
              onClick={() => searchAll(true)}
              disabled={searchingAll || approvingAll}
              style={{ background: "transparent", color: searchingAll ? "#4b5563" : "#fbbf24", border: "1px solid #92400e", borderRadius: 5, padding: "6px 14px", fontSize: 13, cursor: searchingAll ? "not-allowed" : "pointer", fontFamily: "inherit" }}
            >
              {searchingAll ? "Searching…" : `Loose search (${looseSearchCount})`}
            </button>
          )}
          <button
            onClick={() => void load()}
            style={{
              background: "transparent",
              color: "#6b7280",
              border: "1px solid #374151",
              borderRadius: 5,
              padding: "6px 14px",
              fontSize: 13,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {searchBatchErrors.length > 0 && (
        <div style={{ marginBottom: 14, padding: "8px 10px", border: "1px solid #7f1d1d", borderRadius: 5, background: "#1a0c0c", color: "#fca5a5", fontSize: 12 }}>
          {searchBatchErrors.length} search{searchBatchErrors.length === 1 ? "" : "es"} failed. Open the affected track to retry.
        </div>
      )}

      {approvalErrors.length > 0 && (
        <div style={{ marginBottom: 14, padding: "8px 10px", border: "1px solid #7f1d1d", borderRadius: 5, background: "#1a0c0c", color: "#fca5a5", fontSize: 12 }}>
          {approvalErrors.length} approval{approvalErrors.length === 1 ? "" : "s"} failed. Open the affected track to retry.
        </div>
      )}

      {loading ? (
        <p style={{ color: "#4b5563", fontSize: 14 }}>Loading…</p>
      ) : tracks.length === 0 ? (
        <p style={{ color: "#4b5563", fontSize: 14 }}>
          No tracks to review. Import a tracklist first.
        </p>
      ) : (
        tracks.map((t) => (
          <TrackCard key={t.id} track={t} onRefresh={load} onDelete={removeTrack} />
        ))
      )}
    </div>
  );
}
