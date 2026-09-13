import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { TrackRow, TrackState } from "../lib/types";

const ALL_STATES: TrackState[] = [
  "requested",
  "needs_review",
  "matched",
  "approved",
  "downloading",
  "downloaded",
  "quality_failed",
  "picard_pending",
  "ready_for_conversion",
  "tagging_review",
  "ready_for_rekordbox",
  "dj_ready",
  "rekordbox_pending",
  "failed",
];

const STATE_COLOR: Record<TrackState, string> = {
  requested: "#60a5fa",
  needs_review: "#fb923c",
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

function StateColumn({
  state,
  tracks,
}: {
  state: TrackState;
  tracks: TrackRow[];
}) {
  const color = STATE_COLOR[state];
  if (tracks.length === 0) return null;

  return (
    <div
      style={{
        minWidth: 220,
        maxWidth: 260,
        flex: "0 0 auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: color,
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 11,
            color: "#9ca3af",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {state.replace(/_/g, " ")}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "#4b5563",
            background: "#111827",
            borderRadius: 999,
            padding: "1px 7px",
          }}
        >
          {tracks.length}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {tracks.map((t) => (
          <div
            key={t.id}
            style={{
              background: "#1f2937",
              borderRadius: 5,
              padding: "8px 10px",
              borderLeft: `3px solid ${color}44`,
            }}
          >
            <p
              style={{
                fontSize: 12,
                color: "#e5e7eb",
                margin: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={`${t.artist} – ${t.title}`}
            >
              {t.artist ? `${t.artist} – ${t.title}` : t.title}
            </p>
            {t.mix_version && (
              <p
                style={{
                  fontSize: 10,
                  color: "#4b5563",
                  margin: "2px 0 0",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {t.mix_version}
              </p>
            )}
            {t.error && (
              <p
                style={{
                  fontSize: 10,
                  color: "#ef4444",
                  margin: "2px 0 0",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={t.error}
              >
                ⚠ {t.error}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PipelineView() {
  const [byState, setByState] = useState<Partial<Record<TrackState, TrackRow[]>>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all(ALL_STATES.map((s) => api.listTracks(s).then((rows) => [s, rows] as const)))
      .then((pairs) => {
        const map: Partial<Record<TrackState, TrackRow[]>> = {};
        let n = 0;
        for (const [s, rows] of pairs) {
          if (rows.length > 0) map[s] = rows;
          n += rows.length;
        }
        setByState(map);
        setTotal(n);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const activeStates = ALL_STATES.filter((s) => (byState[s]?.length ?? 0) > 0);

  return (
    <div className="view pipeline-view" style={{ padding: 24, color: "#f9fafb" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div className="view-heading">
          <h2>Preparation overview</h2>
          <p>{total} track{total !== 1 ? "s" : ""} across every stage of the workflow.</p>
        </div>
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

      {loading ? (
        <p style={{ color: "#4b5563", fontSize: 14 }}>Loading…</p>
      ) : total === 0 ? (
        <p style={{ color: "#4b5563", fontSize: 14 }}>
          No tracks in the pipeline yet.
        </p>
      ) : (
        <div className="pipeline-board"
          style={{
            display: "flex",
            gap: 16,
            overflowX: "auto",
            paddingBottom: 16,
            alignItems: "flex-start",
          }}
        >
          {activeStates.map((s) => (
            <StateColumn key={s} state={s} tracks={byState[s] ?? []} />
          ))}
        </div>
      )}
    </div>
  );
}
