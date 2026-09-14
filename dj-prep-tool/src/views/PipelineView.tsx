import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { Candidate, QualityResult, RankedCandidate, TrackRow } from "../lib/types";
import { matchQuality } from "../lib/matchQuality";

type PipelineGroupId = "inbox" | "attention" | "progress" | "ready";

const PIPELINE_GROUPS: { id: PipelineGroupId; label: string; description: string; color: string }[] = [
  { id: "inbox", label: "Inbox", description: "New tracks waiting to be reviewed", color: "#60a5fa" },
  { id: "attention", label: "Needs attention", description: "Tracks blocked or needing a fix", color: "#f59e0b" },
  { id: "progress", label: "In progress", description: "Tracks moving through preparation", color: "#a78bfa" },
  { id: "ready", label: "Ready", description: "Tracks ready for DJ use", color: "#34d399" },
];

function groupForTrack(track: TrackRow): PipelineGroupId {
  if (track.state === "dj_ready") return "ready";
  if (track.state === "requested" && !track.search_job_id) return "inbox";
  if (track.state === "needs_review" || track.state === "quality_failed" || track.state === "failed") return "attention";
  if (track.state === "requested" && track.search_job_id) return "attention";
  return "progress";
}

function nextActionFor(track: TrackRow): string {
  if (track.state === "requested" || track.state === "needs_review") return "Search for a file"
  if (track.state === "matched") return "Approve a candidate"
  if (track.state === "approved") return "Start download"
  if (track.state === "downloading") return "Download in progress"
  if (track.state === "downloaded" || track.state === "quality_failed") return "Run quality check"
  if (track.state === "ready_for_conversion") return "Tag in Picard"
  if (track.state === "tagging_review" || track.state === "picard_pending") return "Finish tagging"
  if (track.state === "ready_for_rekordbox" || track.state === "rekordbox_pending") return "Send to Rekordbox"
  if (track.state === "failed") return "Review error"
  if (track.state === "dj_ready") return "Ready to use"
  return "Open details"
}

function emptyGroups(): Record<PipelineGroupId, TrackRow[]> {
  return { inbox: [], attention: [], progress: [], ready: [] };
}

function candidatesFor(track: TrackRow): RankedCandidate[] {
  if (!track.candidate_json) return [];
  try {
    return JSON.parse(track.candidate_json);
  } catch {
    return [];
  }
}

function GroupColumn({
  group,
  tracks,
  onOpen,
}: {
  group: (typeof PIPELINE_GROUPS)[number];
  tracks: TrackRow[];
  onOpen: (track: TrackRow) => void;
}) {
  return (
    <section style={{ minWidth: 260, flex: "1 1 0", background: "#111827", border: "1px solid #293548", borderRadius: 8, padding: 14 }} aria-labelledby={`${group.id}-heading`}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: group.color, display: "inline-block", flexShrink: 0 }} />
        <h3 id={`${group.id}-heading`} style={{ fontSize: 13, color: "#e5e7eb", fontWeight: 600, margin: 0 }}>{group.label}</h3>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#d1d5db", background: "#1f2937", borderRadius: 999, padding: "1px 7px" }}>{tracks.length}</span>
      </div>
      <p style={{ color: "#6b7280", fontSize: 11, margin: "0 0 12px", minHeight: 28 }}>{group.description}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {tracks.length === 0 ? (
          <p style={{ color: "#4b5563", fontSize: 12, margin: 0 }}>Nothing here yet.</p>
        ) : tracks.map((track) => (
          <button key={track.id} onClick={() => onOpen(track)} style={{ background: "#1f2937", border: "none", borderLeft: `3px solid ${group.color}66`, borderRadius: 5, padding: "8px 10px", color: "inherit", textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
            <span style={{ display: "block", fontSize: 12, color: "#e5e7eb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${track.artist} – ${track.title}`}>
              {track.artist ? `${track.artist} – ${track.title}` : track.title}
            </span>
            <span style={{ display: "block", fontSize: 10, color: group.color, marginTop: 3 }}>{nextActionFor(track)}</span>
            {track.mix_version && <span style={{ display: "block", fontSize: 10, color: "#6b7280", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.mix_version}</span>}
            {track.error && <span style={{ display: "block", fontSize: 10, color: "#f87171", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={track.error}>⚠ {track.error}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}

function TrackDrawer({
  track,
  onClose,
  onUpdated,
}: {
  track: TrackRow;
  onClose: () => void;
  onUpdated: (trackId: number) => Promise<void>;
}) {
  const [artist, setArtist] = useState(track.artist);
  const [title, setTitle] = useState(track.title);
  const [mixVersion, setMixVersion] = useState(track.mix_version ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState(() => candidatesFor(track));
  const [quality, setQuality] = useState<QualityResult | null>(null);
  const candidateQuality = matchQuality(candidates);
  const nextStepRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setArtist(track.artist);
    setTitle(track.title);
    setMixVersion(track.mix_version ?? "");
    setCandidates(candidatesFor(track));
    setQuality(null);
    setError(null);
  }, [track]);

  useEffect(() => {
    if (track.state === "requested") nextStepRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [track.state]);

  const update = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () => update(async () => {
    await api.updateTrack(track.id, artist.trim(), title.trim(), mixVersion.trim() || null);
    await onUpdated(track.id);
  });

  const search = (loose = false) => update(async () => {
    const results = loose ? await api.searchTrackLoose(track.id) : await api.searchTrack(track.id);
    setCandidates(results);
    await onUpdated(track.id);
  });

  const approve = (candidate: Candidate) => update(async () => {
    await api.approveCandidate(track.id, candidate.username, candidate.filename);
    await onUpdated(track.id);
  });

  const startDownload = () => update(async () => {
    await api.startDownload(track.id);
    await onUpdated(track.id);
  });

  const qualityCheck = () => update(async () => {
    const result = await api.runQualityCheck(track.id);
    setQuality(result);
    await onUpdated(track.id);
  });

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#0008", zIndex: 10 }} />
      <aside role="dialog" aria-modal="true" aria-labelledby="track-drawer-title" style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(440px, 100vw)", overflowY: "auto", background: "#111827", borderLeft: "1px solid #374151", padding: 22, zIndex: 11, color: "#f9fafb", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 20 }}>
          <div>
            <p style={{ color: "#6b7280", fontSize: 11, margin: "0 0 5px" }}>Track details</p>
            <h2 id="track-drawer-title" style={{ color: "#f9fafb", fontSize: 18, margin: 0 }}>{track.artist ? `${track.artist} – ${track.title}` : track.title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close track details" style={{ background: "transparent", border: "1px solid #374151", borderRadius: 5, color: "#9ca3af", cursor: "pointer", padding: "4px 8px", fontSize: 16 }}>×</button>
        </div>

        <div style={{ display: "grid", gap: 10, marginBottom: 22 }}>
          <label style={{ color: "#9ca3af", fontSize: 12 }}>Artist<input value={artist} onChange={(e) => setArtist(e.target.value)} style={inputStyle} /></label>
          <label style={{ color: "#9ca3af", fontSize: 12 }}>Title<input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} /></label>
          <label style={{ color: "#9ca3af", fontSize: 12 }}>Mix version<input value={mixVersion} onChange={(e) => setMixVersion(e.target.value)} style={inputStyle} /></label>
          <button onClick={save} disabled={busy || !artist.trim() || !title.trim()} style={buttonStyle}>{busy ? "Working…" : "Save track details"}</button>
        </div>

        {error && <p style={{ color: "#f87171", fontSize: 12, background: "#1a0c0c", border: "1px solid #7f1d1d", padding: 8, borderRadius: 5 }}>{error}</p>}

        {(track.state === "requested" || track.state === "needs_review") && <div ref={nextStepRef} style={sectionStyle}><h3 style={sectionHeading}>Next step: find a file</h3><div style={{ display: "flex", gap: 8 }}><button onClick={() => search()} disabled={busy || !artist.trim() || !title.trim()} style={buttonStyle}>{busy ? "Searching…" : "Search"}</button>{track.search_job_id && <button onClick={() => search(true)} disabled={busy} style={secondaryButtonStyle}>Search loose</button>}</div></div>}

        {candidates.length > 0 && (track.state === "matched" || track.state === "requested" || track.state === "needs_review") && <div style={sectionStyle}><h3 style={sectionHeading}>Candidate files</h3>{candidateQuality && <p style={{ color: candidateQuality.color, fontSize: 11, margin: "0 0 8px" }}>{candidateQuality.label}: {candidateQuality.detail}</p>}<div style={{ display: "grid", gap: 6 }}>{candidates.slice(0, 5).map((ranked) => <div key={`${ranked.candidate.username}-${ranked.candidate.filename}`} style={{ background: "#1f2937", borderRadius: 5, padding: 9 }}><p style={{ color: "#d1d5db", fontSize: 12, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={ranked.candidate.filename}>{ranked.candidate.filename}</p><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}><span style={{ color: "#6b7280", fontSize: 11 }}>Score {ranked.score}</span><button onClick={() => approve(ranked.candidate)} disabled={busy} style={buttonStyle}>Approve</button></div></div>)}</div></div>}

        {track.state === "approved" && <div style={sectionStyle}><h3 style={sectionHeading}>Download</h3><button onClick={startDownload} disabled={busy} style={buttonStyle}>{busy ? "Starting…" : "Start download"}</button></div>}
        {track.state === "downloading" && <div style={sectionStyle}><h3 style={sectionHeading}>Download</h3><p style={{ color: "#facc15", fontSize: 13, margin: 0 }}>Download in progress. Check the Download & check view for live progress.</p></div>}
        {(track.state === "downloaded" || track.state === "quality_failed") && <div style={sectionStyle}><h3 style={sectionHeading}>Quality</h3><button onClick={qualityCheck} disabled={busy} style={buttonStyle}>{busy ? "Checking…" : "Run quality check"}</button>{quality && <p style={{ color: quality.isRealFlac ? "#4ade80" : "#f87171", fontSize: 12 }}>{quality.isRealFlac ? "Real FLAC" : "Quality issue"}{quality.notes ? ` — ${quality.notes}` : ""}</p>}</div>}
        {track.downloaded_path && <p style={{ color: "#6b7280", fontSize: 11, wordBreak: "break-all" }}>File: {track.downloaded_path}</p>}
      </aside>
    </>
  );
}

const inputStyle = { display: "block", width: "100%", boxSizing: "border-box" as const, marginTop: 5, background: "#0f172a", border: "1px solid #374151", borderRadius: 5, color: "#f9fafb", padding: "8px 10px", fontFamily: "inherit", fontSize: 13 };
const buttonStyle = { background: "#1e3a5f", color: "#93c5fd", border: "1px solid #1e40af", borderRadius: 5, padding: "7px 12px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" };
const secondaryButtonStyle = { ...buttonStyle, background: "transparent", color: "#9ca3af", borderColor: "#374151" };
const sectionStyle = { borderTop: "1px solid #293548", paddingTop: 16, marginTop: 18 };
const sectionHeading = { color: "#e5e7eb", fontSize: 13, margin: "0 0 10px" };

export default function PipelineView() {
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<TrackRow | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.listTracks().then(setTracks).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const byGroup = tracks.reduce((groups, track) => {
    groups[groupForTrack(track)].push(track);
    return groups;
  }, emptyGroups());

  const updateTrack = async (trackId: number) => {
    const updated = (await api.listTracks()).find((track) => track.id === trackId);
    if (!updated) return;
    setTracks((current) => current.map((track) => track.id === updated.id ? updated : track));
    setSelectedTrack(updated);
  };

  const attentionTrack = tracks.find((track) => groupForTrack(track) === "attention");
  const healthStats = [
    { label: "Needs attention", value: byGroup.attention.length, color: "#f59e0b" },
    { label: "In progress", value: byGroup.progress.length, color: "#a78bfa" },
    { label: "DJ-ready", value: byGroup.ready.length, color: "#34d399" },
    { label: "Completion", value: tracks.length ? `${Math.round((byGroup.ready.length / tracks.length) * 100)}%` : "—", color: "#60a5fa" },
  ];

  return (
    <div className="view pipeline-view" style={{ padding: 24, color: "#f9fafb" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
        <div className="view-heading"><h2>Pipeline</h2><p>{tracks.length} track{tracks.length !== 1 ? "s" : ""} moving from import to DJ-ready.</p></div>
        <div style={{ display: "flex", gap: 8 }}>
          {attentionTrack && <button onClick={() => setSelectedTrack(attentionTrack)} style={buttonStyle}>Continue</button>}
          <button onClick={load} style={secondaryButtonStyle}>Refresh</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, marginBottom: 18 }} aria-label="Library health summary">
        {healthStats.map((stat) => (
          <div key={stat.label} style={{ background: "#111827", border: "1px solid #293548", borderRadius: 6, padding: "10px 12px" }}>
            <div style={{ color: "#6b7280", fontSize: 11 }}>{stat.label}</div>
            <div style={{ color: stat.color, fontSize: 20, fontWeight: 600, marginTop: 3 }}>{stat.value}</div>
          </div>
        ))}
      </div>

      {loading ? <p style={{ color: "#4b5563", fontSize: 14 }}>Loading…</p> : tracks.length === 0 ? <p style={{ color: "#4b5563", fontSize: 14 }}>No tracks in the Pipeline yet. Add tracks to get started.</p> : <div className="pipeline-board" style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 16, alignItems: "flex-start" }}>{PIPELINE_GROUPS.map((group) => <GroupColumn key={group.id} group={group} tracks={byGroup[group.id]} onOpen={setSelectedTrack} />)}</div>}
      {selectedTrack && <TrackDrawer track={selectedTrack} onClose={() => setSelectedTrack(null)} onUpdated={updateTrack} />}
    </div>
  );
}
