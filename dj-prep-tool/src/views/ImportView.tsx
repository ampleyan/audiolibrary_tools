import { useEffect, useMemo, useRef, useState } from "react";
import { Apple, Disc3, FileText, Link2, Music2, Send, Video } from "lucide-react";
import ImportPreview, { buildImportPreview } from "../components/ImportPreview";
import TrackStatusBadge from "../components/TrackStatusBadge";
import { BlockerIndicator } from "../components/TrackRow";
import { api, WORKBENCH_DATA_CHANGED_EVENT } from "../lib/api";
import type { ImportPreviewRow, RekordboxTrack, TrackRow, TrackState } from "../lib/types";
import { getWorkflowMeta } from "../lib/workflow";

type ImportMode = "text" | "csv" | "playlist" | "telegram" | "rekordbox";

function sourceLabel(sourceUrl: string | null) {
  if (!sourceUrl) return "Text";
  const value = sourceUrl.toLowerCase();
  if (value.startsWith("rekordbox:")) return "Rekordbox";
  if (value.includes("t.me/")) return "Telegram";
  if (value.includes("youtube.com") || value.includes("youtu.be")) return "YouTube";
  if (value.includes("spotify.com")) return "Spotify";
  if (value.includes("apple.com")) return "Apple Music";
  return "Link";
}

function SourceIcon({ sourceUrl }: { sourceUrl: string | null }) {
  const label = sourceLabel(sourceUrl);
  const Icon = label === "YouTube" ? Video : label === "Telegram" ? Send : label === "Rekordbox" ? Disc3 : label === "Text" ? FileText : label === "Apple Music" ? Apple : label === "Link" ? Link2 : Music2;
  return <span className={`inbox-source-icon source-${label.toLowerCase().replace(/\s/g, "-")}`} title={label} aria-label={label}><Icon aria-hidden="true" size={15} strokeWidth={1.8} /></span>;
}

export function TrackList({
  tracks,
  onDelete,
  onGoReview,
  onPrepareSelected,
}: {
  tracks: TrackRow[];
  onDelete: (id: number) => void;
  onGoReview: () => void;
  onPrepareSelected: (ids: number[]) => void;
}) {
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<TrackState | "all">("all");
  const [sortKey, setSortKey] = useState<"updated" | "id" | "artist" | "title" | "source" | "tag" | "status">("updated");
  const [descending, setDescending] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

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
  const duplicateTracks = tracks.filter((t) => t.error?.toLowerCase().includes("duplicate of"));
  const duplicateCount = duplicateTracks.length;

  const handleRemoveAllDuplicates = async () => {
    for (const t of duplicateTracks) {
      await handleDelete(t.id);
    }
  };
  const visibleTracks = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const result = tracks.filter((track) => {
      if (stateFilter !== "all" && track.state !== stateFilter) return false;
      return !needle || [track.artist, track.title, track.mix_version ?? "", track.import_tag ?? "", track.state, sourceLabel(track.source_url)].some((value) => value.toLocaleLowerCase().includes(needle));
    });
    return result.sort((left, right) => {
      const values = (track: TrackRow) => ({ updated: Date.parse(track.updated_at) || 0, id: String(track.id), artist: track.artist, title: track.title, source: sourceLabel(track.source_url), tag: track.import_tag ?? "", status: getWorkflowMeta(track).statusLabel });
      const result = sortKey === "updated" ? values(left).updated - values(right).updated : values(left)[sortKey].localeCompare(values(right)[sortKey], undefined, { numeric: sortKey === "id" });
      return (descending ? -1 : 1) * result || left.id - right.id;
    });
  }, [descending, query, sortKey, stateFilter, tracks]);

  if (tracks.length === 0)
    return (
      <p style={{ color: "#4b5563", fontSize: 13, marginTop: 24 }}>
        No tracks yet. Import a tracklist above.
      </p>
    );

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
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 12px", background: "#fbbf2418", border: "1px solid #fbbf2444", borderRadius: 6, marginBottom: 12, fontSize: 12, color: "#fbbf24" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span>{duplicateCount} duplicate{duplicateCount > 1 ? "s" : ""} already in your library</span>
            <button onClick={handleRemoveAllDuplicates} style={{ background: "transparent", border: "1px solid #fbbf2466", borderRadius: 4, color: "#fbbf24", padding: "2px 10px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
              Remove all duplicates
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {duplicateTracks.map((t) => {
              const of = t.error?.match(/duplicate of (#\d+: .+)/i)?.[1];
              return (
                <span key={t.id} style={{ color: "#9ca3af" }}>
                  <span style={{ color: "#fbbf24" }}>{t.artist ? `${t.artist} – ` : ""}{t.title}</span>
                  {of && <> → already exists as {of}</>}
                </span>
              );
            })}
          </div>
        </div>
      )}
      <div className="work-queue-batch" aria-label="Inbox selection actions">
        <strong>{selectedIds.size} selected</strong>
        <button type="button" onClick={() => onPrepareSelected([...selectedIds])} disabled={selectedIds.size === 0}>Prepare selected tracks</button>
        <button type="button" onClick={() => setSelectedIds(new Set())} disabled={selectedIds.size === 0}>Clear selection</button>
      </div>
      <div className="workbench-table-toolbar" aria-label="Filter and sort inbox tracks"><label className="workbench-table-search"><span>Filter tracks</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Artist, title, source, tag…" /></label><label className="workbench-table-select"><span>Status</span><select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as TrackState | "all")}><option value="all">All statuses</option>{Array.from(new Set(tracks.map((track) => track.state))).sort().map((state) => <option key={state} value={state}>{getWorkflowMeta({ state } as TrackRow).statusLabel}</option>)}</select></label><label className="workbench-table-select"><span>Sort by</span><select value={sortKey} onChange={(event) => setSortKey(event.target.value as typeof sortKey)}><option value="updated">Last updated</option><option value="id">Date imported</option><option value="artist">Artist</option><option value="title">Title</option><option value="source">Source</option><option value="tag">Tag</option><option value="status">Status</option></select></label><button className="workbench-sort-direction" type="button" onClick={() => setDescending((value) => !value)}>{descending ? "↓ Descending" : "↑ Ascending"}</button><span className="workbench-table-result-count">{visibleTracks.length} of {tracks.length} shown</span></div>
      <div className="work-queue-list inbox-track-table"><div className="work-queue-columns inbox-track-columns" aria-hidden="true"><span /><span>#</span><span>Track</span><span>Mix</span><span>Source</span><span>Tag</span><span>Status</span><span>Blocker</span><span /></div>{visibleTracks.map((t) => <div key={t.id} className={`workbench-track-row inbox-track-row${selectedIds.has(t.id) ? " is-selected" : ""}${!t.artist ? " no-artist" : ""}`}><label className="workbench-track-check"><span className="sr-only">Select {t.artist ? `${t.artist} – ${t.title}` : t.title}</span><input type="checkbox" checked={selectedIds.has(t.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); event.target.checked ? next.add(t.id) : next.delete(t.id); return next; })} aria-label={`Select ${t.artist ? `${t.artist} – ${t.title}` : t.title}`} /></label><span className="inbox-track-id">{t.id}</span><span className="inbox-track-name" title={t.title}><strong>{t.artist || "Unknown artist"}</strong><span>{t.title}{t.source_url && !t.source_url.startsWith("rekordbox:") && <a href={t.source_url} target="_blank" rel="noreferrer" title={t.source_url} className="inbox-source-link">↗</a>}</span></span><span className="workbench-track-mix">{t.mix_version || "—"}</span><span className="inbox-track-source"><SourceIcon sourceUrl={t.source_url} /></span><span className="inbox-track-tag">{t.import_tag || "—"}</span><TrackStatusBadge metadata={getWorkflowMeta(t)} /><BlockerIndicator track={t} /><span className="inbox-track-actions">{t.error?.toLowerCase().includes("duplicate") && <button type="button" onClick={() => handleDelete(t.id)} disabled={deletingId === t.id} title="Remove imported duplicate">Remove</button>}<button type="button" onClick={() => handleDelete(t.id)} disabled={deletingId === t.id} title="Delete track">✕</button></span></div>)}</div>
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
  const [textPreviewRows, setTextPreviewRows] = useState<ImportPreviewRow[] | null>(null);
  const [ytUrl, setYtUrl] = useState("");
  const [telegramChannelId, setTelegramChannelId] = useState("-1002508065505");
  const [telegramLimit, setTelegramLimit] = useState(100);
  const [telegramPhone, setTelegramPhone] = useState("");
  const [telegramCode, setTelegramCode] = useState("");
  const [telegramPassword, setTelegramPassword] = useState("");
  const [telegramStatus, setTelegramStatus] = useState<string | null>(null);
  const [telegramActivity, setTelegramActivity] = useState<string | null>(null);
  const [telegramLinks, setTelegramLinks] = useState<Array<{ url: string; messageUrl: string }>>([]);
  const [telegramSkipped, setTelegramSkipped] = useState<string[]>([]);
  const [telegramImporting, setTelegramImporting] = useState(false);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [xmlTracks, setXmlTracks] = useState<RekordboxTrack[] | null>(null);
  const [xmlError, setXmlError] = useState<string | null>(null);
  const [selectedPlaylists, setSelectedPlaylists] = useState<Set<string>>(new Set());
  const [playlistSearch, setPlaylistSearch] = useState("");

  const playlistCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of xmlTracks ?? []) for (const p of t.playlists) counts.set(p, (counts.get(p) ?? 0) + 1);
    return counts;
  }, [xmlTracks]);

  const allPlaylists = useMemo(() => {
    const needle = playlistSearch.trim().toLowerCase();
    const sorted = [...playlistCounts.keys()].sort();
    return needle ? sorted.filter((p) => p.toLowerCase().includes(needle)) : sorted;
  }, [playlistCounts, playlistSearch]);

  const rekordboxSelectedTracks = useMemo(() => {
    if (!xmlTracks || selectedPlaylists.size === 0) return [];
    const seen = new Set<string>();
    return xmlTracks.filter((t) => {
      if (!t.playlists.some((p) => selectedPlaylists.has(p))) return false;
      const key = `${t.artist}\0${t.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [xmlTracks, selectedPlaylists]);

  const loadXml = async () => {
    setLoading(true);
    setXmlError(null);
    setXmlTracks(null);
    setSelectedPlaylists(new Set());
    try {
      const preview = await api.checkRekordbox("");
      setXmlTracks(preview.tracksInXml);
    } catch (e) {
      setXmlError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const importRekordbox = async () => {
    if (!rekordboxSelectedTracks.length) return;
    setLoading(true);
    setError(null);
    try {
      const added = await api.importRekordboxPlaylist(rekordboxSelectedTracks);
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

  const togglePlaylist = (p: string) => setSelectedPlaylists((current) => {
    const next = new Set(current);
    if (next.has(p)) next.delete(p); else next.add(p);
    return next;
  });

  useEffect(() => {
    api.listTracks().then(setTracks).catch(() => {});
  }, []);

  useEffect(() => {
    const handleDataChanged = () => { void refresh(); };
    window.addEventListener(WORKBENCH_DATA_CHANGED_EVENT, handleDataChanged);
    return () => window.removeEventListener(WORKBENCH_DATA_CHANGED_EVENT, handleDataChanged);
  }, []);

  useEffect(() => {
    if (mode !== "telegram") return;
    api.telegramCheck().then(setTelegramStatus).catch(() => setTelegramStatus(null));
  }, [mode]);

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

  const textPreview = useMemo(() => {
    if (!textPreviewRows) return null;
    const counts = {
      new: textPreviewRows.filter((row) => !row.duplicate && !row.skipped && !row.warning).length,
      duplicate: textPreviewRows.filter((row) => row.duplicate).length,
      skipped: textPreviewRows.filter((row) => row.skipped).length,
      warning: textPreviewRows.filter((row) => Boolean(row.warning) && !row.skipped).length,
    };
    return { rows: textPreviewRows, counts };
  }, [textPreviewRows]);

  const confirmTextImport = async () => {
    const rows = textPreviewRows?.filter((row) => !row.skipped && !row.warning && row.artist.trim() && row.title.trim()) ?? [];
    if (!rows.length) return;
    await run(() => api.importPreviewRows(rows));
    setTextValue("");
    setTextPreviewRows(null);
    onNavigate?.("prepare");
  };

  const importYoutube = () => run(() => api.importYoutube(ytUrl));

  const startTelegramLogin = async () => {
    setLoading(true);
    setError(null);
    setTelegramStatus(null);
    setTelegramActivity("Sending a Telegram login code…");
    try {
      setTelegramStatus(await api.telegramLoginStart(telegramPhone.trim()));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setTelegramActivity(null);
    }
  };

  const finishTelegramLogin = async () => {
    setLoading(true);
    setError(null);
    setTelegramStatus(null);
    setTelegramActivity("Verifying Telegram login…");
    try {
      setTelegramStatus(await api.telegramLoginCode(telegramCode.trim(), telegramPassword || undefined));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      setTelegramActivity(null);
    }
  };

  const previewTelegram = async () => {
    setLoading(true);
    setError(null);
    setTelegramSkipped([]);
    setTelegramActivity("Fetching newest Telegram posts first…");
    try {
      const links = await api.telegramFetchLinks(telegramChannelId.trim(), telegramLimit);
      setTelegramLinks(links);
      if (links.length === 0) {
        setTelegramActivity(`No YouTube links found in the newest ${telegramLimit} posts.`);
        return;
      }
      setTelegramActivity(`Preview ready: ${links.length} newest YouTube link${links.length === 1 ? "" : "s"} found.`);
    } catch (e) {
      setError(String(e));
      setTelegramActivity("Telegram fetch failed.");
    } finally {
      setLoading(false);
    }
  };

  const importTelegram = async () => {
    if (telegramLinks.length === 0) return;
    telegramStopRequested.current = false;
    setTelegramImporting(true);
    setLoading(true);
    setError(null);
    setTelegramSkipped([]);
    setTelegramActivity("Preparing to import previewed links…");
    try {
      const skipped: string[] = [];
      let imported = 0;
      const importTag = `Telegram · ${new Date().toISOString().slice(0, 10)}`;
      for (let index = 0; index < telegramLinks.length; index += 1) {
        if (telegramStopRequested.current) break;
        const link = telegramLinks[index];
        setTelegramActivity(`Fetching ${index + 1}/${telegramLinks.length}: ${link.url}`);
        try {
          const added = await api.importTelegramLink(link.url, link.messageUrl, importTag);
          imported += added.length;
          if (added.length === 0) {
            skipped.push(`${link.url}: already in library`);
          }
          await refresh();
        } catch (e) {
          skipped.push(`${link.url}: ${String(e)}`);
        }
      }
      setTelegramSkipped(skipped);
      setTelegramActivity(`${telegramStopRequested.current ? "Stopped" : "Finished"}: imported ${imported} track${imported === 1 ? "" : "s"} from ${telegramLinks.length} previewed links.`);
    } catch (e) {
      setError(String(e));
      setTelegramActivity("Telegram fetch failed.");
    } finally {
      setLoading(false);
      setTelegramImporting(false);
    }
  };

  const telegramStopRequested = useRef(false);

  const stopTelegramImport = () => {
    if (!telegramImporting) return;
    telegramStopRequested.current = true;
    setTelegramActivity("Stopping after the current link…");
  };

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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div><h2>Add tracks</h2><p>Add tracks from a playlist, a pasted tracklist, or a CSV export.</p></div>
          {onNavigate && <button style={btn(false)} onClick={() => onNavigate("library")}>Back to Library</button>}
        </div>
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
          {(["playlist", "rekordbox", "telegram", "text", "csv"] as ImportMode[]).map((m) => (
            <button key={m} style={tabStyle(mode === m)} onClick={() => setMode(m)}>
              {m === "playlist" ? "Playlist URL" : m === "rekordbox" ? "Rekordbox XML" : m === "telegram" ? "Telegram" : m === "text" ? "Paste text" : "CSV file"}
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
              onChange={(e) => { setTextValue(e.target.value); setTextPreviewRows(null); }}
              placeholder={"Surgeon - Magneze\n01. Blawan – Getting Me Down (Original Mix)\n• Ancient Methods\tStalker\n# comment"}
            />
            <div style={{ marginTop: 10 }}>
              <button style={btn()} disabled={loading || !textValue.trim()} onClick={() => setTextPreviewRows(buildImportPreview(textValue).rows)}>
                Preview tracks
              </button>
            </div>
            {textPreview && <>
              <ImportPreview model={textPreview} onChange={setTextPreviewRows} />
              <div style={{ marginTop: 10 }}>
                <button style={btn()} disabled={loading || textPreview.counts.new === 0} onClick={confirmTextImport}>
                  {loading ? "Adding…" : `Add ${textPreview.counts.new} reviewed track${textPreview.counts.new === 1 ? "" : "s"}`}
                </button>
              </div>
            </>}
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

        {mode === "rekordbox" && (
          <div>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
              Import tracks from your Rekordbox XML directly as <strong style={{ color: "#4ade80" }}>Rekordbox ready</strong> — no download needed. Requires Rekordbox XML path configured in Settings.
            </p>
            {!xmlTracks && !loading && (
              <button style={btn()} onClick={loadXml}>Load playlists from XML</button>
            )}
            {loading && !xmlTracks && <p style={{ color: "#60a5fa", fontSize: 12 }}>Loading…</p>}
            {xmlError && <p style={{ color: "#f87171", fontSize: 12, marginTop: 8 }}>{xmlError}</p>}
            {xmlTracks && (
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div style={{ width: 220, flexShrink: 0, border: "1px solid #374151", borderRadius: 8, overflow: "hidden", background: "#111827" }}>
                  <div style={{ padding: "10px 12px", borderBottom: "1px solid #1f2937", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ fontSize: 12, color: "#e5e7eb" }}>Playlists</strong>
                    <span style={{ fontSize: 11, color: "#6b7280" }}>{selectedPlaylists.size} selected</span>
                  </div>
                  <div style={{ padding: 8, borderBottom: "1px solid #1f2937" }}>
                    <input value={playlistSearch} onChange={(e) => setPlaylistSearch(e.target.value)} placeholder="Search playlists" style={{ width: "100%", boxSizing: "border-box", background: "#0d0a0f", border: "1px solid #374151", borderRadius: 5, color: "#f1dce6", padding: "6px 8px", fontSize: 12 }} />
                  </div>
                  <div style={{ maxHeight: 260, overflowY: "auto" }}>
                    {allPlaylists.map((p) => {
                      const checked = selectedPlaylists.has(p);
                      return (
                        <label key={p} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer", background: checked ? "#1e3a5f" : "transparent", borderBottom: "1px solid #1f2937", fontSize: 12, color: checked ? "#93c5fd" : "#d1d5db" }}>
                          <input type="checkbox" checked={checked} onChange={() => togglePlaylist(p)} style={{ accentColor: "#3b82f6" }} />
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p}>{p}</span>
                          <span style={{ color: "#6b7280", fontSize: 11, flexShrink: 0 }}>{playlistCounts.get(p)}</span>
                        </label>
                      );
                    })}
                    {allPlaylists.length === 0 && <p style={{ padding: "16px 12px", color: "#6b7280", fontSize: 12, margin: 0 }}>No playlists found.</p>}
                  </div>
                  <div style={{ padding: 8, borderTop: "1px solid #1f2937", display: "flex", gap: 6 }}>
                    <button style={{ ...btn(false), fontSize: 11, padding: "4px 10px" }} onClick={() => setSelectedPlaylists(new Set(allPlaylists))}>All</button>
                    <button style={{ ...btn(false), fontSize: 11, padding: "4px 10px" }} disabled={!selectedPlaylists.size} onClick={() => setSelectedPlaylists(new Set())}>Clear</button>
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, color: "#9ca3af", marginTop: 0 }}>
                    {selectedPlaylists.size === 0
                      ? "Select one or more playlists to import."
                      : <><strong style={{ color: "#e5e7eb" }}>{rekordboxSelectedTracks.length} tracks</strong> from {selectedPlaylists.size} playlist{selectedPlaylists.size === 1 ? "" : "s"} — all will be imported as <strong style={{ color: "#4ade80" }}>Rekordbox ready</strong>. Already-imported tracks are skipped automatically.</>
                    }
                  </p>
                  {rekordboxSelectedTracks.length > 0 && (
                    <button style={btn()} disabled={loading} onClick={importRekordbox}>
                      {loading ? "Importing…" : `Import ${rekordboxSelectedTracks.length} tracks`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {mode === "telegram" && (
          <div>
            <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
              Import YouTube links from a Telegram channel your account can access. First-time use requires Telegram API credentials in Settings and a one-time login.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 120px", gap: 10 }}>
              <input style={{ ...textarea, height: "auto", fontFamily: "inherit", resize: "none" }} value={telegramChannelId} onChange={(e) => { setTelegramChannelId(e.target.value); setTelegramLinks([]); }} placeholder="-1002508065505" aria-label="Telegram channel ID" />
              <input style={{ ...textarea, height: "auto", fontFamily: "inherit", resize: "none" }} type="number" min="1" max="1000" value={telegramLimit} onChange={(e) => { setTelegramLimit(Math.min(1000, Math.max(1, Number(e.target.value) || 100))); setTelegramLinks([]); }} aria-label="Telegram message limit" />
            </div>
            {telegramStatus !== "authorized" && <>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10, marginTop: 10 }}>
                <input style={{ ...textarea, height: "auto", fontFamily: "inherit", resize: "none" }} value={telegramPhone} onChange={(e) => setTelegramPhone(e.target.value)} placeholder="+32…" aria-label="Telegram phone number" />
                <button style={btn(false)} disabled={loading || !telegramPhone.trim()} onClick={startTelegramLogin}>{loading ? "Sending…" : "Send login code"}</button>
              </div>
              {(telegramStatus === "code_required" || telegramStatus === "password_required") && (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto", gap: 10, marginTop: 10 }}>
                  <input style={{ ...textarea, height: "auto", fontFamily: "inherit", resize: "none" }} value={telegramCode} onChange={(e) => setTelegramCode(e.target.value)} placeholder="Telegram code" aria-label="Telegram login code" />
                  <input style={{ ...textarea, height: "auto", fontFamily: "inherit", resize: "none" }} type="password" value={telegramPassword} onChange={(e) => setTelegramPassword(e.target.value)} placeholder="2FA password (if enabled)" aria-label="Telegram two-factor password" />
                  <button style={btn()} disabled={loading || !telegramCode.trim()} onClick={finishTelegramLogin}>{loading ? "Checking…" : "Verify"}</button>
                </div>
              )}
            </>}
            {telegramStatus === "password_required" && <p style={{ color: "#fbbf24", fontSize: 12, margin: "10px 0 0" }}>Telegram requires your two-factor password. Enter it above and verify again.</p>}
            {telegramStatus === "authorized" && <p style={{ color: "#34d399", fontSize: 12, margin: "10px 0 0" }}>Telegram authorized locally — existing session will be reused.</p>}
            <div style={{ marginTop: 10 }}>
              <button style={btn(false)} disabled={loading} onClick={previewTelegram}>{loading ? "Fetching…" : "Preview newest links"}</button>
              <button style={{ ...btn(), marginLeft: 8 }} disabled={loading || telegramLinks.length === 0} onClick={importTelegram}>{loading ? "Importing…" : `Import ${telegramLinks.length || "selected"} links`}</button>
              {telegramImporting && <button style={{ ...btn(false), marginLeft: 8, color: "#fbbf24", borderColor: "#92400e" }} onClick={stopTelegramImport}>Stop import</button>}
            </div>
            {telegramActivity && <p aria-live="polite" style={{ color: loading ? "#60a5fa" : "#34d399", fontSize: 12, margin: "10px 0 0" }}>{telegramActivity}</p>}
            {telegramLinks.length > 0 && <div style={{ maxHeight: 180, overflowY: "auto", marginTop: 10, padding: "6px 10px", background: "#111827", border: "1px solid #374151", borderRadius: 4 }}>
              {telegramLinks.map((link, index) => <div key={`${link.url}-${index}`} style={{ display: "flex", gap: 8, fontSize: 11, padding: "3px 0", borderTop: index > 0 ? "1px solid #1f2937" : "none" }}><span style={{ color: "#6b7280", width: 24 }}>{index + 1}.</span><a href={link.url} target="_blank" rel="noreferrer" style={{ color: "#93c5fd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{link.url}</a></div>)}
            </div>}
            {telegramSkipped.length > 0 && <p style={{ color: "#fbbf24", fontSize: 12, margin: "10px 0 0" }}>{telegramSkipped.length} link{telegramSkipped.length === 1 ? "" : "s"} skipped. The first one: {telegramSkipped[0]}</p>}
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
        onPrepareSelected={(ids) => onNavigate?.(`prepare:${ids.join(",")}`)}
      />
    </div>
  );
}
