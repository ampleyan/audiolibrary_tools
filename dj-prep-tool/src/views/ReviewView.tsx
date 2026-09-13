import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { RankedCandidate, SimilarTrack, TrackRow } from "../lib/types";

const EXT_COLOR: Record<string, string> = {
  flac: "#4ade80",
  mp3: "#60a5fa",
  aac: "#fb923c",
  ogg: "#c084fc",
};

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

function TrackCard({
  track,
  onRefresh,
  onDelete,
}: {
  track: TrackRow;
  onRefresh: () => void;
  onDelete: (id: number) => void;
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
  const [similarTracks, setSimilarTracks] = useState<SimilarTrack[] | null>(null);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [similarErr, setSimilarErr] = useState<string | null>(null);
  const [similarExpanded, setSimilarExpanded] = useState(false);
  const [selectedSimilar, setSelectedSimilar] = useState<Set<number>>(new Set());
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [importingSelected, setImportingSelected] = useState(false);
  const [importErr, setImportErr] = useState<string | null>(null);

  const candidates: RankedCandidate[] = (() => {
    if (!track.candidate_json) return [];
    try {
      return JSON.parse(track.candidate_json);
    } catch {
      return [];
    }
  })();

  const search = async () => {
    setSearching(true);
    setErr(null);
    try {
      await api.searchTrack(track.id);
      onRefresh();
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
      onRefresh();
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
      onRefresh();
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

  const loadSimilar = async () => {
    if (similarTracks !== null) {
      setSimilarExpanded((v) => !v);
      if (similarExpanded) {
        setSelectedSimilar(new Set());
        setPlayingIndex(null);
      }
      return;
    }
    setLoadingSimilar(true);
    setSimilarErr(null);
    try {
      const result = await api.getSimilarTracks(track.id);
      setSimilarTracks(result);
      setSimilarExpanded(true);
    } catch (e) {
      setSimilarErr(String(e));
    } finally {
      setLoadingSimilar(false);
    }
  };

  const toggleSimilarSelect = (i: number) => {
    setSelectedSimilar((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const addSimilarToQueue = async () => {
    if (!similarTracks || selectedSimilar.size === 0) return;
    setImportingSelected(true);
    setImportErr(null);
    try {
      const text = [...selectedSimilar]
        .sort((a, b) => a - b)
        .map((i) => {
          const t = similarTracks[i];
          return t.mixVersion ? `${t.artist} - ${t.title} (${t.mixVersion})` : `${t.artist} - ${t.title}`;
        })
        .join("\n");
      await api.importText(text);
      onRefresh();
      setSelectedSimilar(new Set());
    } catch (e) {
      setImportErr(String(e));
    } finally {
      setImportingSelected(false);
    }
  };

  const saveSimilarPlaylist = () => {
    if (!similarTracks) return;
    const targets = selectedSimilar.size > 0
      ? [...selectedSimilar].sort((a, b) => a - b).map((i) => similarTracks[i])
      : similarTracks;
    const lines = targets.map((t) =>
      t.mixVersion ? `${t.artist} - ${t.title} (${t.mixVersion})` : `${t.artist} - ${t.title}`
    );
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `similar-${track.artist}-${track.title}.txt`.replace(/[\\/:*?"<>|]/g, "_");
    a.click();
    URL.revokeObjectURL(url);
  };

  const getVideoId = (url: string) => url.match(/[?&]v=([^&]+)/)?.[1] ?? null;

  const noResults = track.state === "requested" && !!track.search_job_id;
  const canSearch = track.state === "requested" || track.state === "needs_review";
  const isMatched = track.state === "matched";
  const needsReview = track.state === "needs_review";

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
              onClick={loadSimilar}
              disabled={loadingSimilar}
              style={{
                background: "transparent",
                color: loadingSimilar ? "#4b5563" : "#a78bfa",
                border: "1px solid #4c1d95",
                borderRadius: 4,
                padding: "4px 10px",
                fontSize: 12,
                cursor: loadingSimilar ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                flexShrink: 0,
              }}
              title="Find similar tracks via cosine.club"
            >
              {loadingSimilar
                ? "…"
                : similarTracks !== null
                ? similarExpanded
                  ? "▲ Similar"
                  : `▼ Similar (${similarTracks.length})`
                : "Similar"}
            </button>
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

      {err && (
        <p style={{ color: "#f87171", fontSize: 12, padding: "0 14px 10px" }}>
          {err}
        </p>
      )}

      {similarErr && (
        <p style={{ color: "#f87171", fontSize: 12, padding: "0 14px 10px" }}>
          Similar: {similarErr}
        </p>
      )}

      {similarExpanded && similarTracks !== null && (
        <div style={{ borderTop: "1px solid #111827", padding: "8px 14px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "#6b7280" }}>
              cosine.club — {similarTracks.length} similar
              {selectedSimilar.size > 0 && <span style={{ color: "#a78bfa" }}> · {selectedSimilar.size} selected</span>}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              {selectedSimilar.size > 0 && (
                <button
                  onClick={addSimilarToQueue}
                  disabled={importingSelected}
                  style={{
                    background: importingSelected ? "#111827" : "#065f46",
                    color: importingSelected ? "#4b5563" : "#34d399",
                    border: "none",
                    borderRadius: 4,
                    padding: "3px 10px",
                    fontSize: 11,
                    cursor: importingSelected ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {importingSelected ? "Adding…" : `Add ${selectedSimilar.size} to queue`}
                </button>
              )}
              <button
                onClick={saveSimilarPlaylist}
                style={{
                  background: "transparent",
                  color: "#6b7280",
                  border: "1px solid #374151",
                  borderRadius: 4,
                  padding: "3px 10px",
                  fontSize: 11,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {selectedSimilar.size > 0 ? `Save ${selectedSimilar.size}` : "Save all"} as playlist
              </button>
            </div>
          </div>
          {importErr && (
            <p style={{ fontSize: 11, color: "#f87171", margin: "0 0 6px" }}>{importErr}</p>
          )}
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {similarTracks.map((t, i) => {
              const videoId = t.videoUrl ? getVideoId(t.videoUrl) : null;
              const isPlaying = playingIndex === i;
              return (
                <div key={i} style={{ borderTop: i > 0 ? "1px solid #111827" : "none" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "5px 0",
                      fontSize: 12,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSimilar.has(i)}
                      onChange={() => toggleSimilarSelect(i)}
                      style={{ flexShrink: 0, accentColor: "#a78bfa", cursor: "pointer" }}
                    />
                    <span
                      style={{
                        fontSize: 10,
                        color: "#6b7280",
                        width: 34,
                        textAlign: "right",
                        flexShrink: 0,
                      }}
                    >
                      {t.score.toFixed(3)}
                    </span>
                    <span style={{ flex: 1, color: "#d1d5db" }}>
                      {t.artist} – {t.title}
                      {t.mixVersion && (
                        <span style={{ color: "#6b7280", marginLeft: 6 }}>{t.mixVersion}</span>
                      )}
                    </span>
                    {videoId && (
                      <button
                        onClick={() => setPlayingIndex(isPlaying ? null : i)}
                        style={{
                          background: isPlaying ? "#1e3a5f" : "transparent",
                          color: isPlaying ? "#60a5fa" : "#4b5563",
                          border: isPlaying ? "1px solid #1e40af" : "none",
                          borderRadius: 4,
                          padding: "2px 7px",
                          fontSize: 11,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          flexShrink: 0,
                        }}
                        title={isPlaying ? "Stop" : "Play inline"}
                      >
                        {isPlaying ? "⏹" : "▶"}
                      </button>
                    )}
                  </div>
                  {isPlaying && videoId && (
                    <iframe
                      src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
                      width="100%"
                      height="160"
                      allow="autoplay; encrypted-media"
                      style={{ display: "block", border: "none", borderRadius: 4, marginBottom: 6 }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isMatched && expanded && candidates.length > 0 && (
        <div style={{ borderTop: "1px solid #111827", padding: "0 14px 10px" }}>
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

export default function ReviewView() {
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchingAll, setSearchingAll] = useState(false);
  const [searchProgress, setSearchProgress] = useState<{ done: number; total: number } | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.listTracks("requested"),
      api.listTracks("needs_review"),
      api.listTracks("matched"),
    ])
      .then(([a, b, c]) => setTracks([...a, ...b, ...c]))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const removeTrack = (id: number) =>
    setTracks((prev) => prev.filter((t) => t.id !== id));

  const searchAll = async () => {
    const searchable = tracks.filter(
      (t) => t.state === "requested" || t.state === "needs_review"
    );
    if (searchable.length === 0) return;
    setSearchingAll(true);
    setSearchProgress({ done: 0, total: searchable.length });
    for (let i = 0; i < searchable.length; i++) {
      try {
        await api.searchTrack(searchable[i].id);
      } catch {
        // continue with remaining tracks
      }
      setSearchProgress({ done: i + 1, total: searchable.length });
    }
    setSearchingAll(false);
    setSearchProgress(null);
    load();
  };

  const searchableCount = tracks.filter(
    (t) => t.state === "requested" || t.state === "needs_review"
  ).length;

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
          {searchableCount > 0 && (
            <button
              onClick={searchAll}
              disabled={searchingAll}
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
          <button
            onClick={load}
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
