import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { TrackRow, TrackState } from "../lib/types";

const STATE_COLOR: Record<TrackState, string> = {
  requested: "#60a5fa",
  needs_review: "#fb923c",
  not_found: "#9ca3af",
  matched: "#c084fc",
  approved: "#34d399",
  downloading: "#facc15",
  downloaded: "#22d3ee",
  quality_failed: "#f87171",
  picard_pending: "#818cf8",
  ready_for_conversion: "#a3e635",
  tagging_review: "#f59e0b",
  ready_for_rekordbox: "#86efac",
  dj_ready: "#4ade80",
  rekordbox_pending: "#38bdf8",
  failed: "#ef4444",
};

type ImportMode = "text" | "csv" | "playlist";

function StateBadge({ state }: { state: TrackState }) {
  return (
    <span
      style={{
        fontSize: 10,
        padding: "2px 7px",
        borderRadius: 999,
        background: `${STATE_COLOR[state]}22`,
        color: STATE_COLOR[state],
        fontWeight: 600,
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
      }}
    >
      {state.replace(/_/g, " ")}
    </span>
  );
}

function TrackList({
  tracks,
  onDelete,
  onGoReview,
}: {
  tracks: TrackRow[];
  onDelete: (id: number) => void;
  onGoReview: () => void;
}) {
  const [deletingId, setDeletingId] = useState<number | null>(null);

  if (tracks.length === 0)
    return (
      <p style={{ color: "#4b5563", fontSize: 13, marginTop: 24 }}>
        No tracks yet. Import a tracklist above.
      </p>
    );

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await api.deleteTrack(id);
      onDelete(id);
    } finally {
      setDeletingId(null);
    }
  };

  const needsReviewCount = tracks.filter((t) => t.state === "needs_review").length;
  const duplicateCount = tracks.filter((t) => t.error?.toLowerCase().includes("duplicate")).length;

  return (
    <>
      {needsReviewCount > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px",
            background: "#fb923c18",
            border: "1px solid #fb923c44",
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 12,
            color: "#fb923c",
          }}
        >
          <span>{needsReviewCount} track{needsReviewCount > 1 ? "s" : ""} need artist/title review</span>
          <button
            onClick={onGoReview}
            style={{
              background: "transparent",
              border: "1px solid #fb923c66",
              borderRadius: 4,
              color: "#fb923c",
              padding: "2px 10px",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Go to Review →
          </button>
        </div>
      )}
      {duplicateCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#fbbf2418", border: "1px solid #fbbf2444", borderRadius: 6, marginBottom: 12, fontSize: 12, color: "#fbbf24" }}>
          <span>{duplicateCount} duplicate{duplicateCount > 1 ? "s" : ""} detected</span>
          <span style={{ color: "#9ca3af" }}>Remove the imported copy if you do not want to keep both.</span>
        </div>
      )}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
        }}
      >
        <thead>
          <tr style={{ color: "#6b7280", textAlign: "left" }}>
            <th style={{ padding: "6px 10px 6px 0", fontWeight: 500 }}>#</th>
            <th style={{ padding: "6px 10px", fontWeight: 500 }}>Artist</th>
            <th style={{ padding: "6px 10px", fontWeight: 500 }}>Title</th>
            <th style={{ padding: "6px 10px", fontWeight: 500 }}>Mix</th>
            <th style={{ padding: "6px 10px", fontWeight: 500 }}>State</th>
            <th style={{ padding: "6px 0", fontWeight: 500 }} />
          </tr>
        </thead>
        <tbody>
          {tracks.map((t) => (
            <tr
              key={t.id}
              style={{
                borderTop: "1px solid #1f2937",
                color: t.state === "failed" ? "#6b7280" : "#e5e7eb",
              }}
            >
              <td style={{ padding: "7px 10px 7px 0", color: "#4b5563" }}>
                {t.id}
              </td>
              <td style={{ padding: "7px 10px" }}>{t.artist || "—"}</td>
              <td style={{ padding: "7px 10px" }}>
                {t.title}
                {t.source_url && (
                  <span
                    title={t.source_url}
                    style={{ marginLeft: 6, fontSize: 10, color: "#374151" }}
                  >
                    ▶
                  </span>
                )}
              </td>
              <td style={{ padding: "7px 10px", color: "#6b7280" }}>
                {t.mix_version || ""}
              </td>
              <td style={{ padding: "7px 10px" }}>
                <StateBadge state={t.state} />
                {t.error && (
                  <span
                    title={t.error}
                    style={{ marginLeft: 6, color: t.state === "not_found" ? "#9ca3af" : "#ef4444", fontSize: 10 }}
                  >
                    {t.state === "not_found" ? "ⓘ" : "⚠"}
                  </span>
                )}
              </td>
              <td style={{ padding: "7px 0", textAlign: "right" }}>
                {t.error?.toLowerCase().includes("duplicate") && (
                  <button
                    disabled={deletingId === t.id}
                    onClick={() => handleDelete(t.id)}
                    style={{ background: "transparent", border: "1px solid #92400e", borderRadius: 4, color: "#fbbf24", cursor: deletingId === t.id ? "not-allowed" : "pointer", fontSize: 11, padding: "3px 6px", fontFamily: "inherit", marginRight: 4 }}
                    title="Remove imported duplicate"
                  >
                    Remove duplicate
                  </button>
                )}
                <button
                  disabled={deletingId === t.id}
                  onClick={() => handleDelete(t.id)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: deletingId === t.id ? "#374151" : "#4b5563",
                    cursor: deletingId === t.id ? "not-allowed" : "pointer",
                    fontSize: 13,
                    padding: "2px 6px",
                    fontFamily: "inherit",
                  }}
                  title="Delete track"
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: "6px 16px",
  fontSize: 13,
  border: "none",
  borderBottom: active ? "2px solid #3b82f6" : "2px solid transparent",
  background: "transparent",
  color: active ? "#93c5fd" : "#6b7280",
  cursor: "pointer",
  fontFamily: "inherit",
});

const textarea: React.CSSProperties = {
  width: "100%",
  height: 140,
  background: "#111827",
  border: "1px solid #374151",
  borderRadius: 4,
  color: "#f9fafb",
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "monospace",
  resize: "vertical",
  boxSizing: "border-box",
};

const btn = (primary = true): React.CSSProperties => ({
  background: primary ? "#2563eb" : "transparent",
  color: primary ? "#fff" : "#6b7280",
  border: primary ? "none" : "1px solid #374151",
  borderRadius: 5,
  padding: "7px 18px",
  fontSize: 13,
  cursor: "pointer",
  fontFamily: "inherit",
});

export default function ImportView({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const [mode, setMode] = useState<ImportMode>("playlist");
  const [textValue, setTextValue] = useState("");
  const [ytUrl, setYtUrl] = useState("");
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.listTracks().then(setTracks).catch(() => {});
  }, []);

  const refresh = () => api.listTracks().then(setTracks).catch(() => {});

  const run = async (action: () => Promise<TrackRow[]>) => {
    setLoading(true);
    setError(null);
    try {
      const added = await action();
      setTracks((prev) => {
        const ids = new Set(added.map((t) => t.id));
        return [...added, ...prev.filter((t) => !ids.has(t.id))];
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const importText = () =>
    run(() => api.importText(textValue)).then(() => setTextValue(""));

  const importYoutube = () => run(() => api.importYoutube(ytUrl));

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      run(() => api.importCsv(content));
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const clearAll = async () => {
    if (!window.confirm(`Delete all ${tracks.length} tracks? This cannot be undone.`)) return;
    setClearing(true);
    try {
      await api.clearTracks();
      setTracks([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setClearing(false);
    }
  };

  const removeTrack = (id: number) =>
    setTracks((prev) => prev.filter((t) => t.id !== id));

  return (
    <div className="view import-view" style={{ padding: "24px", color: "#f9fafb" }}>
      <div className="view-heading">
        <h2>Bring in your tracks</h2>
        <p>Start with a playlist, a pasted tracklist, or a CSV export.</p>
      </div>

      <div
        style={{
          background: "#1f2937",
          borderRadius: 8,
          padding: 20,
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #1f2937", marginBottom: 16 }}>
          {(["playlist", "text", "csv"] as ImportMode[]).map((m) => (
            <button key={m} style={tabStyle(mode === m)} onClick={() => setMode(m)}>
              {m === "playlist" ? "Playlist URL" : m === "text" ? "Paste text" : "CSV file"}
            </button>
          ))}
        </div>

        {mode === "text" && (
          <div>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
              One track per line. Accepts <code style={{ color: "#9ca3af" }}>Artist - Title</code>, en/em dashes, tabs, numbered lines, and bullets. Mix names and audio extensions are cleaned automatically. Lines starting with # are ignored.
            </p>
            <textarea
              style={textarea}
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              placeholder={"Surgeon - Magneze\n01. Blawan – Getting Me Down (Original Mix)\n• Ancient Methods\tStalker\n# comment"}
            />
            <div style={{ marginTop: 10 }}>
              <button
                style={btn()}
                disabled={loading || !textValue.trim()}
                onClick={importText}
              >
                {loading ? "Importing…" : "Import tracks"}
              </button>
            </div>
          </div>
        )}

        {mode === "csv" && (
          <div>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
              CSV with headers: <code style={{ color: "#9ca3af" }}>artist, title, mix_version, source_url</code> (case-insensitive, extras ignored).
              Smart parsing auto-fixes track numbers, file extensions, combined columns, mix versions, and duplicates — hover ⚠ on any track to see what was changed.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={onFileChange}
            />
            <button style={btn()} onClick={() => fileRef.current?.click()}>
              {loading ? "Importing…" : "Choose CSV file…"}
            </button>
          </div>
        )}

        {mode === "playlist" && (
          <div>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
              Paste a playlist URL. Supported:{" "}
              <span style={{ color: "#9ca3af" }}>YouTube · Spotify · Apple Music</span>.{" "}
              Spotify requires credentials in Settings. Apple Music and YouTube work without credentials (YouTube private playlists need a cookies file).
            </p>
            <input
              style={{
                ...textarea,
                height: "auto",
                fontFamily: "inherit",
                resize: "none",
              }}
              value={ytUrl}
              onChange={(e) => setYtUrl(e.target.value)}
              placeholder="https://open.spotify.com/playlist/… or youtube.com/… or music.apple.com/…"
            />
            <div style={{ marginTop: 10 }}>
              <button
                style={btn()}
                disabled={loading || !ytUrl.trim()}
                onClick={importYoutube}
              >
                {loading ? "Fetching…" : "Fetch tracklist"}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p style={{ color: "#f87171", fontSize: 13, marginTop: 12 }}>{error}</p>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 500, color: "#9ca3af" }}>
          All tracks ({tracks.length})
        </h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btn(false)} onClick={refresh}>
            Refresh
          </button>
          {tracks.length > 0 && (
            <button
              style={{
                ...btn(false),
                color: clearing ? "#4b5563" : "#f87171",
                border: "1px solid #374151",
              }}
              disabled={clearing}
              onClick={clearAll}
            >
              {clearing ? "Clearing…" : "Clear all"}
            </button>
          )}
        </div>
      </div>

      <TrackList
        tracks={tracks}
        onDelete={removeTrack}
        onGoReview={() => onNavigate?.("review")}
      />
    </div>
  );
}
