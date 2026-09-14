import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { QualityResult, TrackRow, TrackState } from "../lib/types";

const DOWNLOAD_STATES: TrackState[] = [
  "approved",
  "downloading",
  "downloaded",
  "quality_failed",
  "picard_pending",
  "ready_for_conversion",
  "tagging_review",
  "ready_for_rekordbox",
  "failed",
];

function fmt(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function QualityBadge({ result }: { result: QualityResult }) {
  if (result.isRealFlac === null) {
    return <span style={{ color: "#6b7280", fontSize: 12 }}>⊘ {result.notes}</span>;
  }

  const meta = [
    result.sampleRate ? `${(result.sampleRate / 1000).toFixed(1)}kHz` : null,
    result.bitDepth ? `${result.bitDepth}-bit` : null,
    result.channels === 1 ? "mono" : result.channels === 2 ? "stereo" : null,
    result.durationSecs ? `${Math.round(result.durationSecs / 60)}m` : null,
    result.spectralCutoffHz
      ? `cutoff ~${Math.round(result.spectralCutoffHz / 1000)}kHz`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (result.isRealFlac) {
    return (
      <span style={{ color: "#4ade80", fontSize: 12 }}>
        ✓ Real FLAC
        {meta && (
          <span style={{ color: "#374151", marginLeft: 6 }}>{meta}</span>
        )}
      </span>
    );
  }
  return (
    <span style={{ color: "#f87171", fontSize: 12 }} title={result.notes}>
      ✗ Fake FLAC
      {meta && (
        <span style={{ color: "#374151", marginLeft: 6 }}>{meta}</span>
      )}
    </span>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = Math.min(100, Math.round((done / total) * 100));
  return (
    <div style={{ marginTop: 6 }}>
      <div
        style={{
          height: 3,
          borderRadius: 2,
          background: "#1f2937",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: "#facc15",
            borderRadius: 2,
            transition: "width 0.4s ease",
          }}
        />
      </div>
      <span style={{ fontSize: 10, color: "#d97706", marginTop: 2, display: "block" }}>
        {pct}% — {fmt(done)} / {fmt(total)}
      </span>
    </div>
  );
}

function DownloadCard({
  track,
  onUpdate,
  onRefresh,
}: {
  track: TrackRow;
  onUpdate: (t: TrackRow) => void;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [qualityResult, setQualityResult] = useState<QualityResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState("");
  const [progress, setProgress] = useState<{ bytesOnDisk: number | null; bytesTotal: number | null } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (track.state !== "downloading") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    const tick = () =>
      api.checkDownloadProgress(track.id).then(setProgress).catch(() => {});
    tick();
    pollRef.current = setInterval(tick, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [track.id, track.state]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setBusyLabel(label);
    setErr(null);
    try {
      const result = await fn();
      if (result && typeof result === "object" && "id" in result) {
        onUpdate(result as TrackRow);
      }
      onRefresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  };

  const startDownload = () => act("Starting…", () => api.startDownload(track.id));
  const pollDownload = () => act("Polling… (up to 10 min)", () => api.pollDownload(track.id));
  const qualityCheck = () =>
    act("Checking…", async () => {
      const r = await api.runQualityCheck(track.id);
      setQualityResult(r);
    });
  const tagTrack = () => act("Tagging…", () => api.tagTrack(track.id));
  const openFolder = (path: string | null) => {
    if (!path) return;
    act("Opening…", () => api.openFolder(path));
  };
  const markAsTagged = () => act("…", () => api.updateTrackState(track.id, "ready_for_rekordbox"));
  const markImported = () => act("…", () => api.updateTrackState(track.id, "dj_ready"));

  const isDownloading = track.state === "downloading";

  const qualityPassed =
    qualityResult?.isRealFlac === true ||
    track.state === "ready_for_conversion" ||
    track.state === "tagging_review";

  const rekordboxReady =
    track.state === "ready_for_rekordbox" || track.state === "dj_ready";

  const qualityFailed =
    qualityResult?.isRealFlac === false || track.state === "quality_failed";

  const cardBg = isDownloading
    ? "#1c1a0f"
    : rekordboxReady
    ? "#0c1220"
    : qualityPassed
    ? "#0c1a0e"
    : qualityFailed
    ? "#1a0c0c"
    : "#1f2937";

  const cardBorder = isDownloading
    ? "3px solid #d97706"
    : rekordboxReady
    ? "3px solid #818cf8"
    : qualityPassed
    ? "3px solid #22c55e"
    : qualityFailed
    ? "3px solid #ef4444"
    : "3px solid transparent";

  const stateColor = isDownloading
    ? "#d97706"
    : rekordboxReady
    ? "#818cf8"
    : qualityPassed
    ? "#4ade80"
    : qualityFailed
    ? "#f87171"
    : "#6b7280";

  return (
    <div
      style={{
        background: cardBg,
        borderRadius: 6,
        padding: "12px 16px",
        marginBottom: 10,
        borderLeft: cardBorder,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 14, color: "#e5e7eb", fontWeight: 500, margin: 0 }}>
            {track.artist ? `${track.artist} – ${track.title}` : track.title}
            {track.mix_version && (
              <span style={{ color: "#6b7280", fontWeight: 400, marginLeft: 8, fontSize: 13 }}>
                {track.mix_version}
              </span>
            )}
          </p>
          {track.selected_filename && (
            <p
              style={{
                fontSize: 11,
                color: "#4b5563",
                margin: "4px 0 0",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 460,
              }}
              title={track.selected_filename}
            >
              {track.selected_filename.replace(/\\/g, "/").split("/").pop()}
              {track.selected_username && (
                <span style={{ color: "#374151" }}> — {track.selected_username}</span>
              )}
            </p>
          )}
          {isDownloading && progress?.bytesOnDisk != null && progress?.bytesTotal != null && (
            <ProgressBar done={progress.bytesOnDisk} total={progress.bytesTotal} />
          )}
          {isDownloading && progress?.bytesOnDisk != null && progress?.bytesTotal == null && (
            <p style={{ fontSize: 10, color: "#d97706", margin: "4px 0 0" }}>
              {fmt(progress.bytesOnDisk)} on disk…
            </p>
          )}
          {track.downloaded_path && (
            <p style={{ fontSize: 11, color: "#374151", margin: "4px 0 0" }}>
              {track.downloaded_path}
            </p>
          )}
          {qualityResult && (
            <div style={{ marginTop: 6 }}>
              <QualityBadge result={qualityResult} />
              {qualityResult.notes && qualityResult.isRealFlac !== null && (
                <span style={{ fontSize: 11, color: "#4b5563", marginLeft: 8 }}>
                  {qualityResult.notes}
                </span>
              )}
            </div>
          )}
          {track.quality_result === "fake_flac" && !qualityResult && (
            <p style={{ fontSize: 12, color: "#f87171", margin: "4px 0 0" }}>
              ✗ Fake FLAC detected
              {track.quality_notes && ` — ${track.quality_notes}`}
            </p>
          )}
          {track.state === "tagging_review" && (
            <p style={{ fontSize: 12, color: "#fb923c", margin: "4px 0 0" }}>
              {track.error ?? "Weak match — tag manually with Picard, then mark as tagged."}
            </p>
          )}
          {track.state === "ready_for_rekordbox" && track.archive_path && (
            <p style={{ fontSize: 11, color: "#4b5563", margin: "4px 0 0", wordBreak: "break-all" }}>
              {track.archive_path}
            </p>
          )}
          {err && (
            <div
              style={{
                marginTop: 6,
                padding: "5px 8px",
                background: "#1a0c0c",
                border: "1px solid #7f1d1d",
                borderRadius: 4,
                display: "flex",
                alignItems: "flex-start",
                gap: 6,
              }}
            >
              <span style={{ fontSize: 12, color: "#f87171", flex: 1, wordBreak: "break-word" }}>{err}</span>
              <button
                onClick={() => setErr(null)}
                style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", padding: 0, fontSize: 13, lineHeight: 1, flexShrink: 0 }}
              >
                ✕
              </button>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 160 }}>
          <span style={{ fontSize: 10, color: stateColor, textAlign: "right", letterSpacing: "0.04em" }}>
            {track.state.replace(/_/g, " ")}
          </span>
          {track.state === "approved" && (
            <ActionBtn label="Start download" busy={busy} busyLabel={busyLabel} onClick={startDownload} />
          )}
          {track.state === "failed" && track.selected_filename && (
            <ActionBtn label="Retry download" busy={busy} busyLabel={busyLabel} onClick={startDownload} />
          )}
          {isDownloading && (
            <ActionBtn label="Poll for completion" busy={busy} busyLabel={busyLabel} onClick={pollDownload} />
          )}
          {(track.state === "downloaded" || track.state === "quality_failed") && (
            <ActionBtn label="Quality check" busy={busy} busyLabel={busyLabel} onClick={qualityCheck} />
          )}
          {track.downloaded_path && (
            <ActionBtn label="Convert" busy={busy} busyLabel={busyLabel} onClick={tagTrack} />
          )}
          {track.state === "tagging_review" && (
            <ActionBtn label="Open folder" busy={busy} busyLabel={busyLabel} onClick={() => openFolder(track.downloaded_path)} />
          )}
          {track.state === "ready_for_rekordbox" && (
            <ActionBtn label="Open folder" busy={busy} busyLabel={busyLabel} onClick={() => openFolder(track.archive_path)} />
          )}
          {(track.state === "tagging_review" || track.state === "ready_for_conversion") && (
            <ActionBtn label="Mark as ready" busy={busy} busyLabel={busyLabel} onClick={markAsTagged} />
          )}
          {track.state === "ready_for_rekordbox" && (
            <ActionBtn label="Mark imported" busy={busy} busyLabel={busyLabel} onClick={markImported} />
          )}
          <select
            disabled={busy}
            value=""
            onChange={(e) => {
              const s = e.target.value;
              if (s) act("…", () => api.updateTrackState(track.id, s));
            }}
            style={{
              marginTop: 4,
              background: "#111827",
              color: "#4b5563",
              border: "1px solid #1f2937",
              borderRadius: 4,
              padding: "4px 6px",
              fontSize: 11,
              cursor: busy ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              width: "100%",
            }}
          >
            <option value="">set state…</option>
            <option value="approved">approved</option>
            <option value="downloading">downloading</option>
            <option value="downloaded">downloaded</option>
            <option value="quality_failed">quality failed</option>
            <option value="ready_for_conversion">ready for conversion</option>
            <option value="tagging_review">tagging review</option>
            <option value="ready_for_rekordbox">ready for rekordbox</option>
            <option value="dj_ready">dj ready</option>
            <option value="failed">failed</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function ActionBtn({
  label,
  busy,
  busyLabel,
  onClick,
}: {
  label: string;
  busy: boolean;
  busyLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        background: busy ? "#111827" : "#1e3a5f",
        color: busy ? "#4b5563" : "#60a5fa",
        border: "1px solid #1e40af",
        borderRadius: 4,
        padding: "5px 12px",
        fontSize: 12,
        cursor: busy ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        textAlign: "center",
      }}
    >
      {busy ? busyLabel || "…" : label}
    </button>
  );
}

type BatchOp = "download" | "retry" | "check" | "convert";

export default function DownloadView() {
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [batchOp, setBatchOp] = useState<BatchOp | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchErrors, setBatchErrors] = useState<string[]>([]);

  const load = (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    Promise.all(DOWNLOAD_STATES.map((s) => api.listTracks(s)))
      .then((groups) => setTracks(groups.flat()))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => load(true), []);

  const runBatch = async (op: BatchOp, subset: TrackRow[], action: (t: TrackRow) => Promise<unknown>) => {
    if (!subset.length) return;
    setBatchOp(op);
    setBatchErrors([]);
    setBatchProgress({ done: 0, total: subset.length });
    const errs: string[] = [];
    for (let i = 0; i < subset.length; i++) {
      const t = subset[i];
      try {
        await action(t);
      } catch (e) {
        errs.push(`${t.artist} – ${t.title}: ${String(e)}`);
      }
      setBatchProgress({ done: i + 1, total: subset.length });
    }
    setBatchOp(null);
    setBatchProgress(null);
    if (errs.length) setBatchErrors(errs);
    load(true);
  };

  const downloadAll = () =>
    runBatch("download", tracks.filter((t) => t.state === "approved"), (t) =>
      api.startDownload(t.id)
    );

  const retryAll = () =>
    runBatch("retry", tracks.filter((t) => t.state === "failed" && !!t.selected_filename), (t) =>
      api.startDownload(t.id)
    );

  const checkAll = () =>
    runBatch("check", tracks.filter((t) => t.state === "downloaded" || t.state === "quality_failed"), (t) =>
      api.runQualityCheck(t.id)
    );

  const convertAll = () =>
    runBatch("convert", tracks.filter((t) => t.state === "ready_for_conversion"), (t) =>
      api.tagTrack(t.id)
    );

  const approvedCount = tracks.filter((t) => t.state === "approved").length;
  const failedCount = tracks.filter((t) => t.state === "failed" && !!t.selected_filename).length;
  const checkableCount = tracks.filter((t) => t.state === "downloaded" || t.state === "quality_failed").length;
  const convertibleCount = tracks.filter((t) => t.state === "ready_for_conversion").length;

  const isBusy = batchOp !== null;

  const batchBtn = (
    op: BatchOp,
    label: string,
    count: number,
    onClick: () => void,
  ) => {
    if (!count) return null;
    const active = batchOp === op;
    return (
      <button
        onClick={onClick}
        disabled={isBusy}
        style={{
          background: isBusy ? "#111827" : "#1e3a5f",
          color: isBusy ? "#4b5563" : "#60a5fa",
          border: "1px solid #1e40af",
          borderRadius: 5,
          padding: "6px 14px",
          fontSize: 13,
          cursor: isBusy ? "not-allowed" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {active && batchProgress
          ? `${label.split(" ")[0]}ing… ${batchProgress.done}/${batchProgress.total}`
          : `${label} (${count})`}
      </button>
    );
  };

  return (
    <div className="view download-view" style={{ padding: 24, color: "#f9fafb" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div className="view-heading">
          <h2>Download and prepare</h2>
          <p>Move approved tracks through download, quality check, tagging, and Rekordbox.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {batchBtn("download", "Download all", approvedCount, downloadAll)}
          {batchBtn("retry", "Retry failed", failedCount, retryAll)}
          {batchBtn("check", "Check all", checkableCount, checkAll)}
          {batchBtn("convert", "Convert all", convertibleCount, convertAll)}
          <button
            onClick={() => load(true)}
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

      {batchErrors.length > 0 && (
        <div
          style={{
            background: "#1a0c0c",
            border: "1px solid #7f1d1d",
            borderRadius: 6,
            padding: "10px 14px",
            marginBottom: 16,
          }}
        >
          <p style={{ fontSize: 12, color: "#f87171", margin: "0 0 6px", fontWeight: 600 }}>
            {batchErrors.length} error{batchErrors.length > 1 ? "s" : ""} during batch
          </p>
          {batchErrors.map((e, i) => (
            <p key={i} style={{ fontSize: 11, color: "#fca5a5", margin: "2px 0" }}>{e}</p>
          ))}
        </div>
      )}

      {loading ? (
        <p style={{ color: "#4b5563", fontSize: 14 }}>Loading…</p>
      ) : tracks.length === 0 ? (
        <p style={{ color: "#4b5563", fontSize: 14 }}>
          No tracks in the download pipeline. Approve candidates in Review first.
        </p>
      ) : (
        tracks.map((t) => (
          <DownloadCard
            key={t.id}
            track={t}
            onUpdate={(updated) => setTracks((ts) => ts.map((x) => (x.id === updated.id ? updated : x)))}
            onRefresh={load}
          />
        ))
      )}
    </div>
  );
}
