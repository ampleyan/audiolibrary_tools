import { useEffect, useRef, useState } from "react";
import { api, WORKBENCH_DATA_CHANGED_EVENT } from "../lib/api";
import type { QualityResult, TrackRow, TrackState } from "../lib/types";

const DOWNLOAD_STATES: TrackState[] = [
  "approved",
  "downloading",
  "downloaded",
  "conversion_pending",
  "converted",
  "quality_failed",
  "picard_pending",
  "ready_for_conversion",
  "tagging_review",
  "ready_for_rekordbox",
  "rekordbox_pending",
  "dj_ready",
  "failed",
];

const RETURN_STAGES: { state: TrackState; label: string }[] = [
  { state: "requested", label: "Find files" },
  { state: "approved", label: "Download" },
  { state: "conversion_pending", label: "Convert" },
  { state: "converted", label: "Quality check" },
  { state: "ready_for_conversion", label: "Beets tagging" },
  { state: "ready_for_rekordbox", label: "Rekordbox" },
];

const PIPELINE_RANK: Partial<Record<TrackState, number>> = {
  requested: 0,
  needs_review: 0,
  not_found: 0,
  matched: 0,
  approved: 1,
  downloading: 1,
  failed: 1,
  conversion_pending: 2,
  downloaded: 3,
  converted: 3,
  quality_failed: 3,
  ready_for_conversion: 4,
  tagging_review: 4,
  picard_pending: 4,
  ready_for_rekordbox: 5,
  rekordbox_pending: 5,
  dj_ready: 6,
};

function fmt(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function QualityBadge({ result }: { result: QualityResult }) {
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

  if (result.isRealFlac === null) {
    if (result.spectralPassed === null) {
      return <span style={{ color: "#6b7280", fontSize: 12 }}>⊘ {result.notes}</span>;
    }
    return (
      <span style={{ color: result.spectralPassed ? "#4ade80" : "#f87171", fontSize: 12 }}>
        {result.spectralPassed ? "✓ MP3 spectral check passed" : "✗ MP3 spectral check failed"}
        {meta && <span style={{ color: "#374151", marginLeft: 6 }}>{meta}</span>}
      </span>
    );
  }

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

function ProgressBar({ done, total, speed }: { done: number; total: number; speed: number | null }) {
  const pct = Math.min(100, Math.round((done / total) * 100));
  const eta = speed ? Math.max(0, Math.ceil((total - done) / speed / 60)) : null;
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
        {pct}% — {fmt(done)} / {fmt(total)}{speed ? ` · ${fmt(speed)}/s` : ""}{eta !== null ? ` · ETA ${eta} min` : ""}
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
  const [returnStage, setReturnStage] = useState<TrackState>("requested");
  const [progress, setProgress] = useState<{ bytesOnDisk: number | null; bytesTotal: number | null; speed: number | null } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressSample = useRef<{ bytes: number; at: number } | null>(null);

  useEffect(() => {
    if (track.state !== "downloading") {
      if (pollRef.current) clearInterval(pollRef.current);
      progressSample.current = null;
      return;
    }
    const tick = () => api.checkDownloadProgress(track.id).then((next) => {
      const now = Date.now();
      const previous = progressSample.current;
      const speed = previous && next.bytesOnDisk != null && next.bytesOnDisk >= previous.bytes
        ? (next.bytesOnDisk - previous.bytes) / Math.max(1, (now - previous.at) / 1000)
        : null;
      if (next.bytesOnDisk != null) progressSample.current = { bytes: next.bytesOnDisk, at: now };
      setProgress({ ...next, speed });
    }).catch(() => {});
    tick();
    pollRef.current = setInterval(tick, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [track.id, track.state]);

  const act = async (label: string, fn: () => Promise<unknown>, refresh = true) => {
    setBusy(true);
    setBusyLabel(label);
    setErr(null);
    try {
      const result = await fn();
      if (result && typeof result === "object" && "id" in result) {
        onUpdate(result as TrackRow);
      }
      if (refresh) onRefresh();
    } catch (e) {
      setErr(String(e));
      if (refresh) onRefresh();
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  };

  const startDownload = () => act("Starting…", () => api.startDownload(track.id));
  const pollDownload = () => act("Polling… (up to 10 min)", () => api.pollDownload(track.id));
  const cancelDownload = () => act("Cancelling…", () => api.cancelDownload(track.id));
  const convertTrack = () => act("Converting…", () => api.convertTrack(track.id));
  const qualityCheck = () =>
    act("Checking…", async () => {
      const r = await api.runQualityCheck(track.id);
      setQualityResult(r);
      onUpdate({
        ...track,
        state: r.isRealFlac === false || r.spectralPassed === false ? "quality_failed" : "ready_for_conversion",
        quality_result: r.isRealFlac === false ? "fake_flac" : r.spectralPassed === false ? "low_spectral_cutoff" : "ok",
        quality_notes: r.notes,
      });
    }, false);
  const tagTrack = () => act("Tagging…", () => api.tagTrack(track.id));
  const openFolder = (path: string | null) => {
    if (!path) return;
    act("Opening…", () => api.openFolder(path));
  };
  const markAsTagged = () => act("…", () => api.updateTrackState(track.id, "ready_for_rekordbox"));
  const markImported = () => act("…", () => api.finishRekordbox(track.id));
  const availableReturnStages = RETURN_STAGES.filter((stage) => (PIPELINE_RANK[stage.state] ?? 0) < (PIPELINE_RANK[track.state] ?? 0));
  const selectedReturnStage = availableReturnStages.find((stage) => stage.state === returnStage) ?? availableReturnStages[0];
  const returnToStage = () => {
    if (!selectedReturnStage || !window.confirm(`Move ${track.artist ? `${track.artist} – ` : ""}${track.title} back to ${selectedReturnStage.label}? Later-stage results may need to be repeated.`)) return;
    act("Moving…", async () => {
      await api.updateTrackState(track.id, selectedReturnStage.state);
      onUpdate({ ...track, state: selectedReturnStage.state, quality_result: null, quality_notes: null, error: null });
      setQualityResult(null);
    });
  };

  const isDownloading = track.state === "downloading";

  const qualityPassed =
    qualityResult?.isRealFlac === true ||
    track.state === "ready_for_conversion" ||
    track.state === "tagging_review" ||
    track.state === "picard_pending";

  const rekordboxReady =
    track.state === "ready_for_rekordbox" || track.state === "dj_ready";

  const qualityFailed =
    qualityResult?.isRealFlac === false || qualityResult?.spectralPassed === false || track.state === "quality_failed";

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
            <ProgressBar done={progress.bytesOnDisk} total={progress.bytesTotal} speed={progress.speed} />
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
          {track.error && (track.state === "downloading" || track.state === "failed") && (
            <p style={{ fontSize: 11, color: track.state === "failed" ? "#f87171" : "#facc15", margin: "4px 0 0" }}>
              {track.error}
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
          {!qualityResult && track.quality_result === "ok" && (
            <p style={{ fontSize: 12, color: "#4ade80", margin: "4px 0 0" }}>
              ✓ Quality check passed — ready for Beets tagging
              {track.quality_notes && ` — ${track.quality_notes}`}
            </p>
          )}
          {track.quality_result === "fake_flac" && !qualityResult && (
            <p style={{ fontSize: 12, color: "#f87171", margin: "4px 0 0" }}>
              ✗ Fake FLAC detected
              {track.quality_notes && ` — ${track.quality_notes}`} · Choose another candidate or retry after verifying the file.
            </p>
          )}
          {track.quality_result === "low_spectral_cutoff" && !qualityResult && (
            <p style={{ fontSize: 12, color: "#f87171", margin: "4px 0 0" }}>✗ Spectral check failed{track.quality_notes && ` — ${track.quality_notes}`} · Choose another candidate or retry after verifying the file.</p>
          )}
          {(track.state === "tagging_review" || track.state === "picard_pending") && (
            <p style={{ fontSize: 12, color: "#fb923c", margin: "4px 0 0" }}>
              {track.error ?? "Beets needs a manual match review before this can continue."} Review artist, title, and mix in Picard, then mark tagging complete.
            </p>
          )}
          {track.state === "ready_for_rekordbox" && track.archive_path && (
            <p style={{ fontSize: 11, color: "#4b5563", margin: "4px 0 0", wordBreak: "break-all" }}>
              {track.archive_path}
            </p>
          )}
          {track.dj_path && <p style={{ fontSize: 11, color: "#facc15", margin: "4px 0 0" }}>A Rekordbox destination is already recorded. Confirm it before copying to avoid a collision.</p>}
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
            {track.state === "picard_pending" ? "tagging review" : track.state.replace(/_/g, " ")}
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
          {isDownloading && (
            <ActionBtn label="Cancel download" busy={busy} busyLabel={busyLabel} onClick={cancelDownload} />
          )}
          {track.state === "conversion_pending" && (
            <ActionBtn label="Convert to MP3" busy={busy} busyLabel={busyLabel} onClick={convertTrack} />
          )}
          {(track.state === "downloaded" || track.state === "converted" || track.state === "quality_failed") && !qualityResult && (
            <ActionBtn label="Quality check" busy={busy} busyLabel={busyLabel} onClick={qualityCheck} />
          )}
          {qualityResult && (
            <span style={{ color: qualityResult.spectralPassed === false || qualityResult.isRealFlac === false ? "#f87171" : "#4ade80", fontSize: 12, textAlign: "right" }}>
              {qualityResult.spectralPassed === false || qualityResult.isRealFlac === false ? "✗ Quality failed" : qualityResult.isRealFlac === null ? "✓ Quality complete" : "✓ Quality passed"}
            </span>
          )}
          {track.state === "ready_for_conversion" && (
            <ActionBtn label="Run Beets tagging" busy={busy} busyLabel={busyLabel} onClick={tagTrack} />
          )}
          {(track.state === "tagging_review" || track.state === "picard_pending") && (
            <ActionBtn label="Reveal in Finder/Explorer" busy={busy} busyLabel={busyLabel} onClick={() => openFolder(track.downloaded_path)} />
          )}
          {track.state === "ready_for_rekordbox" && (
            <ActionBtn label="Reveal in Finder/Explorer" busy={busy} busyLabel={busyLabel} onClick={() => openFolder(track.archive_path)} />
          )}
          {(track.state === "tagging_review" || track.state === "picard_pending") && (
            <ActionBtn label="Mark tagging complete" busy={busy} busyLabel={busyLabel} onClick={markAsTagged} />
          )}
          {track.state === "ready_for_rekordbox" && (
            <ActionBtn label="Copy to Rekordbox" busy={busy} busyLabel={busyLabel} onClick={markImported} />
          )}
          {!isDownloading && selectedReturnStage && (
            <div style={{ display: "flex", gap: 4 }}>
              <select
                value={returnStage}
                disabled={busy}
                onChange={(event) => setReturnStage(event.target.value as TrackState)}
                aria-label="Move track back to stage"
                style={{ minWidth: 0, flex: 1, background: "#111827", color: "#9ca3af", border: "1px solid #374151", borderRadius: 4, padding: "5px 4px", fontSize: 11, fontFamily: "inherit" }}
              >
                {availableReturnStages.map((stage) => <option key={stage.state} value={stage.state}>{stage.label}</option>)}
              </select>
              <ActionBtn label={`Move back to ${selectedReturnStage.label}`} busy={busy} busyLabel={busyLabel} onClick={returnToStage} />
            </div>
          )}
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

type BatchOp = "download" | "retry" | "convert" | "check" | "tag";

export default function DownloadView({ states = DOWNLOAD_STATES, embedded = false, selectedTrackId, emptyMessage = "No tracks in the download pipeline. Approve candidates in Review first.", onTrackChanged }: { states?: TrackState[]; embedded?: boolean; selectedTrackId?: number; emptyMessage?: string; onTrackChanged?: (track: TrackRow) => void }) {
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [batchOp, setBatchOp] = useState<BatchOp | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchErrors, setBatchErrors] = useState<string[]>([]);

  const load = (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    Promise.all(states.map((s) => api.listTracks(s)))
      .then((groups) => setTracks(groups.flat()))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => load(true), [states]);
  useEffect(() => {
    const handleDataChanged = () => { void load(false); };
    window.addEventListener(WORKBENCH_DATA_CHANGED_EVENT, handleDataChanged);
    return () => window.removeEventListener(WORKBENCH_DATA_CHANGED_EVENT, handleDataChanged);
  }, [states]);

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

  const convertAll = () =>
    runBatch("convert", tracks.filter((t) => t.state === "conversion_pending"), (t) =>
      api.convertTrack(t.id)
    );

  const checkAll = () =>
    runBatch("check", tracks.filter((t) => t.state === "downloaded" || t.state === "converted" || t.state === "quality_failed"), (t) =>
      api.runQualityCheck(t.id)
    );

  const tagAll = () =>
    runBatch("tag", tracks.filter((t) => t.state === "ready_for_conversion"), (t) =>
      api.tagTrack(t.id)
    );

  const approvedCount = tracks.filter((t) => t.state === "approved").length;
  const failedCount = tracks.filter((t) => t.state === "failed" && !!t.selected_filename).length;
  const checkableCount = tracks.filter((t) => t.state === "downloaded" || t.state === "converted" || t.state === "quality_failed").length;
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
        {!embedded && <div className="view-heading">
          <h2>Download and prepare</h2>
          <p>Move approved tracks through download, quality check, tagging, and Rekordbox.</p>
        </div>}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {batchBtn("download", "Download all", approvedCount, downloadAll)}
          {batchBtn("retry", "Retry failed", failedCount, retryAll)}
          {batchBtn("convert", "Convert all", tracks.filter((t) => t.state === "conversion_pending").length, convertAll)}
          {batchBtn("check", "Check all", checkableCount, checkAll)}
          {batchBtn("tag", "Tag all with Beets", convertibleCount, tagAll)}
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
          {emptyMessage}
        </p>
      ) : (
        [...tracks].sort((a, b) => Number(b.id === selectedTrackId) - Number(a.id === selectedTrackId)).map((t) => (
          <DownloadCard
            key={t.id}
            track={t}
            onUpdate={(updated) => {
              setTracks((ts) => ts.map((x) => (x.id === updated.id ? updated : x)));
              onTrackChanged?.(updated);
            }}
            onRefresh={load}
          />
        ))
      )}
    </div>
  );
}
