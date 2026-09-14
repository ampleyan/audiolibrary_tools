import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { RankedCandidate, SimilarTrack, TrackRow } from "../lib/types";
import { matchQuality } from "../lib/matchQuality";
import { PipelineSeedListbox } from "../components/PipelineSeedListbox";

const EXT_COLOR: Record<string, string> = {
  flac: "#4ade80",
  mp3: "#60a5fa",
  aac: "#fb923c",
  ogg: "#c084fc",
};

function parseCandidates(track: TrackRow): RankedCandidate[] {
  if (!track.candidate_json) return [];
  try {
    return JSON.parse(track.candidate_json);
  } catch {
    return [];
  }
}

function ExtBadge({ ext }: { ext: string }) {
  const color = EXT_COLOR[ext.toLowerCase()] ?? "#6b7280";
  return (
    <span
      style={{
        fontSize: 10,
        padding: "2px 6px",
        borderRadius: 3,
        background: `${color}22`,
        color,
        fontWeight: 700,
        letterSpacing: "0.05em",
      }}
    >
      {ext.toUpperCase()}
    </span>
  );
}

function CandidateRow({
  rc,
  onApprove,
  approving,
}: {
  rc: RankedCandidate;
  onApprove: () => void;
  approving: boolean;
}) {
  const c = rc.candidate;
  const name = c.filename.replace(/\\/g, "/").split("/").pop() ?? c.filename;
  return (
    <tr style={{ borderTop: "1px solid #1f2937", fontSize: 12 }}>
      <td style={{ padding: "6px 8px" }}>
        <ExtBadge ext={c.extension} />
      </td>
      <td
        style={{
          padding: "6px 8px",
          color: "#d1d5db",
          maxWidth: 300,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={c.filename}
      >
        {name}
      </td>
      <td style={{ padding: "6px 8px", color: "#6b7280" }}>
        {c.bitRate ? `${c.bitRate} kbps` : "—"}
      </td>
      <td style={{ padding: "6px 8px", color: "#6b7280" }}>
        {c.length ? `${Math.floor(c.length / 60)}:${String(c.length % 60).padStart(2, "0")}` : "—"}
      </td>
      <td style={{ padding: "6px 8px", color: "#9ca3af" }}>{rc.score}</td>
      <td style={{ padding: "6px 8px" }}>
        <button
          onClick={onApprove}
          disabled={approving}
          style={{
            background: approving ? "#1f2937" : "#065f46",
            color: approving ? "#4b5563" : "#34d399",
            border: "none",
            borderRadius: 4,
            padding: "3px 10px",
            fontSize: 12,
            cursor: approving ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {approving ? "…" : "Approve"}
        </button>
      </td>
    </tr>
  );
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

export function SimilarPanel({ tracks, onOpenLibrary }: { tracks: TrackRow[]; onOpenLibrary?: () => void }) {
  const [sourceIds, setSourceIds] = useState<number[]>(tracks[0] ? [tracks[0].id] : []);
  const [similarTracks, setSimilarTracks] = useState<SimilarTrack[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [maxResults, setMaxResults] = useState(25);
  const [minimumScore, setMinimumScore] = useState(0);
  const [sourceProgress, setSourceProgress] = useState<string | null>(null);
  const [sourceLabels, setSourceLabels] = useState<Record<string, string[]>>({});
  const [youtubeResult, setYoutubeResult] = useState<{ playlistUrl: string; added: number; skipped: string[] } | null>(null);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [creatingYoutube, setCreatingYoutube] = useState(false);

  const getVideoId = (url: string) => url.match(/[?&]v=([^&]+)/)?.[1] ?? null;
  const selectedSources = tracks.filter((track) => sourceIds.includes(track.id));
  const selectedTrack = selectedSources[0] ?? tracks[0];
  const visibleTracks = similarTracks
    ?.filter((track) => track.score >= minimumScore)
    .slice(0, maxResults);
  const playingTrack = playingIndex === null ? null : visibleTracks?.[playingIndex] ?? null;
  const playingVideoId = playingTrack?.videoUrl ? getVideoId(playingTrack.videoUrl) : null;

  useEffect(() => {
    const validIds = sourceIds.filter((id) => tracks.some((track) => track.id === id));
    if (validIds.length !== sourceIds.length) {
      setSourceIds(validIds.length > 0 ? validIds : tracks[0] ? [tracks[0].id] : []);
    }
  }, [tracks, sourceIds]);

  useEffect(() => {
    setSelected(new Set());
    setPlayingIndex(null);
  }, [maxResults, minimumScore]);

  const load = async () => {
    if (selectedSources.length === 0) return;
    setLoading(true);
    setError(null);
    setImportedCount(null);
    setSimilarTracks(null);
    setSourceLabels({});
    setSelected(new Set());
    setPlayingIndex(null);
    try {
      const combined = new Map<string, SimilarTrack>();
      const labels: Record<string, string[]> = {};
      const failures: string[] = [];
      for (const [index, source] of selectedSources.entries()) {
        setSourceProgress(`${index + 1}/${selectedSources.length}`);
        try {
          const results = await api.getSimilarTracks(source.id);
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
          <div className="similar-column-heading"><h3>Choose seed tracks</h3><p>Select one or more Pipeline tracks.</p></div>
          <PipelineSeedListbox tracks={tracks} selectedIds={sourceIds} onChange={(ids) => {
            setSourceIds(ids);
            setSimilarTracks(null);
            setSourceLabels({});
            setSelected(new Set());
            setPlayingIndex(null);
            setError(null);
          }} />
          <button onClick={load} disabled={selectedSources.length === 0 || loading} style={{ background: loading ? "#1f2937" : "#4c1d95", color: loading ? "#4b5563" : "#ddd6fe", border: "1px solid #6d28d9", borderRadius: 5, padding: "6px 12px", fontSize: 12, cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
            {loading ? `Finding ${sourceProgress ?? "…"}` : similarTracks ? "Refresh" : "Find similar"}
          </button>
        </aside>
        <div className="similar-results-column">
          <div className="similar-column-heading"><h3>Similar tracks</h3></div>
          {error && <p style={{ color: "#f87171", fontSize: 12, margin: "0 0 8px" }}>{error}</p>}
          {importError && <p style={{ color: "#f87171", fontSize: 12, margin: "0 0 8px" }}>{importError}</p>}
          {importedCount !== null && <p aria-live="polite" style={{ color: "#34d399", fontSize: 12, margin: "0 0 8px" }}>Added {importedCount} track{importedCount === 1 ? "" : "s"} to Library.{onOpenLibrary && <button onClick={onOpenLibrary} style={{ background: "transparent", color: "#93c5fd", border: "1px solid #1e40af", borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer", fontFamily: "inherit", marginLeft: 8 }}>View Library</button>}</p>}
          {youtubeError && <p style={{ color: "#f87171", fontSize: 12, margin: "0 0 8px" }}>{youtubeError}</p>}
          {youtubeResult && <p style={{ color: "#34d399", fontSize: 12, margin: "0 0 8px" }}>Created playlist with {youtubeResult.added} tracks. <a href={youtubeResult.playlistUrl} target="_blank" rel="noreferrer" style={{ color: "#60a5fa" }}>Open YouTube playlist</a>{youtubeResult.skipped.length > 0 && ` · Skipped ${youtubeResult.skipped.length} unavailable or rejected`}</p>}
          {similarTracks === null && !loading && !error && <p style={{ color: "#6b7280", fontSize: 12, margin: 0 }}>Choose a track and find related music.</p>}
          {similarTracks !== null && (
            <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ color: "#6b7280", fontSize: 11 }}>{visibleTracks?.length ?? 0} of {similarTracks.length} similar tracks{selected.size > 0 && <span style={{ color: "#a78bfa" }}> · {selected.size} selected</span>}</span>
            <div style={{ display: "flex", gap: 6 }}>
              {selected.size > 0 && <button onClick={addToQueue} disabled={importing} style={{ background: importing ? "#1f2937" : "#065f46", color: importing ? "#4b5563" : "#34d399", border: "none", borderRadius: 4, padding: "3px 10px", fontSize: 11, cursor: importing ? "not-allowed" : "pointer", fontFamily: "inherit" }}>{importing ? "Adding…" : `Add ${selected.size} to Library`}</button>}
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
          {playingTrack && playingVideoId && <div className="similar-player" aria-label={`Previewing ${playingTrack.artist} ${playingTrack.title}`}>
            <div className="similar-player-meta"><span>Previewing now</span><strong>{playingTrack.artist} – {playingTrack.title}</strong><button type="button" onClick={() => setPlayingIndex(null)}>Stop</button></div>
            <iframe title={`Preview ${playingTrack.artist} ${playingTrack.title}`} src={`https://www.youtube.com/embed/${playingVideoId}?autoplay=1`} allow="autoplay; encrypted-media" />
          </div>}
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {visibleTracks?.map((track, index) => {
              const videoId = track.videoUrl ? getVideoId(track.videoUrl) : null;
              const isPlaying = playingIndex === index;
              const key = track.cosineId || `${track.artist}\u0000${track.title}`;
              return <div key={`${track.cosineId}-${index}`} style={{ borderTop: index > 0 ? "1px solid #1f2937" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 12 }}>
                  <input type="checkbox" checked={selected.has(index)} onChange={() => toggleSelect(index)} aria-label={`Select ${track.artist} ${track.title}`} style={{ flexShrink: 0, accentColor: "#a78bfa", cursor: "pointer" }} />
                  <span style={{ color: "#6b7280", width: 34, textAlign: "right", flexShrink: 0 }}>{track.score.toFixed(3)}</span>
                  <span style={{ flex: "0 1 auto", minWidth: 0, maxWidth: "calc(100% - 96px)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#d1d5db" }}>{track.artist} – {track.title}{track.mixVersion && <span style={{ color: "#6b7280", marginLeft: 6 }}>{track.mixVersion}</span>}</span>
                  {videoId && <button onClick={() => setPlayingIndex(isPlaying ? null : index)} aria-label={isPlaying ? "Stop preview" : "Play preview"} style={{ flexShrink: 0, background: isPlaying ? "#1e3a5f" : "transparent", color: isPlaying ? "#60a5fa" : "#4b5563", border: isPlaying ? "1px solid #1e40af" : "none", borderRadius: 4, padding: "2px 7px", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>{isPlaying ? "⏹" : "▶"}</button>}
                </div>
                <div style={{ color: "#4b5563", fontSize: 10, padding: "0 0 5px 78px" }}>From {sourceLabels[key]?.join(", ")}</div>
              </div>;
            })}
          </div>
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
  onTrackChanged,
}: {
  track: TrackRow;
  onRefresh: () => Promise<void>;
  onDelete: (id: number) => void;
  onTrackChanged?: (track: TrackRow) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [expanded, setExpanded] = useState(track.state === "matched");
  const [approvingFile, setApprovingFile] = useState<string | null>(null);
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
      setExpanded(true);
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
      setExpanded(true);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSearching(false);
    }
  };

  const approve = async (rc: RankedCandidate) => {
    setApprovingFile(rc.candidate.filename);
    setErr(null);
    try {
      await api.approveCandidate(track.id, rc.candidate.username, rc.candidate.filename);
      onTrackChanged?.({ ...track, state: "approved", selected_username: rc.candidate.username, selected_filename: rc.candidate.filename });
      await onRefresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setApprovingFile(null);
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
  const quality = matchQuality(candidates);

  return (
    <div
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
        {quality && <span title={quality.detail} style={{ color: quality.color, fontSize: 10, flexShrink: 0 }}>{quality.label}</span>}

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
                Edit
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
                {searching ? "Searching…" : "Search"}
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
                {searching ? "Searching…" : "Search loose"}
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
                Mark not found
              </button>
            )}
            {isMatched && (
              <button
                onClick={() => setExpanded((v) => !v)}
                style={{
                  background: "transparent",
                  color: "#6b7280",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 13,
                  fontFamily: "inherit",
                  flexShrink: 0,
                }}
              >
                {expanded ? "▲" : `▼ ${candidates.length} results`}
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
          <span>Try: edit artist/title for accuracy, then search again. Soulseek availability varies — some tracks may not be shared by anyone online right now.</span>
        </div>
      )}

      {isMatched && candidates.length > 0 && (
        <div style={{ borderTop: "1px solid #064e3b", borderBottom: "1px solid #064e3b", background: "#062e2b", padding: "9px 14px", color: "#6ee7b7", fontSize: 12 }}>
          Match found. Choose a file below to move this track to Download.
        </div>
      )}

      {err && (
        <p style={{ color: "#f87171", fontSize: 12, padding: "0 14px 10px" }}>
          {err}
        </p>
      )}

      {isMatched && expanded && candidates.length > 0 && (
        <div style={{ borderTop: "1px solid #111827", padding: "0 14px 10px" }}>
          {quality && <p style={{ color: quality.color, fontSize: 11, margin: "8px 0 2px" }}>{quality.label}: {quality.detail}</p>}
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "#4b5563", fontSize: 11 }}>
                <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 400 }}>Fmt</th>
                <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 400 }}>Filename</th>
                <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 400 }}>Bitrate</th>
                <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 400 }}>Length</th>
                <th style={{ padding: "6px 8px", textAlign: "left", fontWeight: 400 }}>Score</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {candidates.map((rc, i) => (
                <CandidateRow
                  key={i}
                  rc={rc}
                  onApprove={() => approve(rc)}
                  approving={approvingFile === rc.candidate.filename}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ReviewView({ onTrackChanged }: { onTrackChanged?: (track: TrackRow) => void }) {
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
      const [a, b, c, d] = await Promise.all([
        api.listTracks("requested"),
        api.listTracks("needs_review"),
        api.listTracks("matched"),
        api.listTracks("not_found"),
      ]);
      setTracks([...a, ...b, ...c, ...d]);
    } catch {
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

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
            <span style={{ fontSize: 12, color: "#6b7280" }}>
              {searchProgress.done}/{searchProgress.total}
            </span>
          )}
          {approvalProgress && (
            <span style={{ fontSize: 12, color: "#6b7280" }}>
              {approvalProgress.done}/{approvalProgress.total}
            </span>
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
              {searchingAll ? "Searching…" : `Retry loose (${looseSearchCount})`}
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
          <TrackCard key={t.id} track={t} onRefresh={load} onDelete={removeTrack} onTrackChanged={onTrackChanged} />
        ))
      )}
    </div>
  );
}
