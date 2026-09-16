import { useEffect, useMemo, useState } from "react";
import TrackInspector, { type InspectorMatchingAction, type InspectorPipelineAction } from "../components/TrackInspector";
import TrackRow, { type TrackMenuAction } from "../components/TrackRow";
import { api, WORKBENCH_DATA_CHANGED_EVENT } from "../lib/api";
import type { TrackActionId, TrackRow as Track, TrackState } from "../lib/types";
import { getWorkflowMeta, isActionable, isWorkflowBlocked } from "../lib/workflow";
import DownloadView from "./DownloadView";
import ReviewView from "./ReviewView";

export type PrepareStage = "find" | "match" | "download" | "convert" | "quality" | "tag" | "rekordbox";
export type WorkQueueView = "needs_attention" | "running" | "ready_to_dj";
export type PreparationFilter = "needs_attention" | "needs_action" | "running" | "blocked" | "done" | "all";
type StageFilter = PrepareStage | "all";
export type TrackSortKey = "priority" | "artist" | "title" | "status" | "updated" | "created";
export type TrackSortDirection = "asc" | "desc";

const FIND_STATES: TrackState[] = ["requested", "needs_review", "not_found"];
const MATCH_STATES: TrackState[] = ["matched"];
const STAGE_ORDER: Array<PrepareStage | "done"> = ["find", "match", "download", "convert", "quality", "tag", "rekordbox", "done"];

const STAGES: Array<{ id: PrepareStage; label: string; description: string; states: TrackState[] }> = [
  { id: "find", label: "Find files", description: "Search Soulseek and widen the query when a precise search returns nothing.", states: FIND_STATES },
  { id: "match", label: "Match", description: "Review candidate files and choose the correct version.", states: MATCH_STATES },
  { id: "download", label: "Download", description: "Start approved downloads, monitor progress, and retry failures.", states: ["approved", "downloading", "failed"] },
  { id: "convert", label: "Convert", description: "Convert lossless sources into the configured DJ format.", states: ["conversion_pending"] },
  { id: "quality", label: "Quality", description: "Run authenticity and spectral checks before tagging.", states: ["downloaded", "converted", "quality_failed"] },
  { id: "tag", label: "Tag", description: "Complete Beets or manual Picard metadata review.", states: ["ready_for_conversion", "tagging_review", "picard_pending"] },
  { id: "rekordbox", label: "Rekordbox", description: "Hand finished files to Rekordbox and confirm completion.", states: ["ready_for_rekordbox", "rekordbox_pending", "dj_ready"] },
];

const FILTERS: Array<{ id: Exclude<PreparationFilter, "needs_attention" | "all">; label: string; description: string }> = [
  { id: "needs_action", label: "Needs action", description: "Ready for a user-triggered next step." },
  { id: "running", label: "Running", description: "Active work that can be monitored." },
  { id: "blocked", label: "Blocked", description: "Needs a decision, correction, or retry." },
  { id: "done", label: "Done", description: "Completed and ready for DJ use." },
];

function preparationBucket(track: Track): Exclude<PreparationFilter, "needs_attention" | "all"> {
  const metadata = getWorkflowMeta(track);
  if (metadata.bucket === "ready_to_dj") return "done";
  if (metadata.bucket === "running") return "running";
  if (isWorkflowBlocked(track)) return "blocked";
  return "needs_action";
}

export function filterPreparationTracks(tracks: Track[], filter: PreparationFilter, stage: StageFilter) {
  return tracks.filter((track) => {
    const metadata = getWorkflowMeta(track);
    const matchesQueue = filter === "all"
      || (filter === "needs_attention" ? metadata.bucket === "needs_attention" || metadata.bucket === "inbox" : preparationBucket(track) === filter);
    return matchesQueue && (stage === "all" || metadata.stage === stage);
  });
}

export function prioritizeActionableTracks(tracks: Track[]) {
  return tracks.filter(isActionable).sort((a, b) => {
    const blockedDifference = Number(isWorkflowBlocked(b)) - Number(isWorkflowBlocked(a));
    if (blockedDifference) return blockedDifference;
    const stageDifference = STAGE_ORDER.indexOf(getWorkflowMeta(a).stage) - STAGE_ORDER.indexOf(getWorkflowMeta(b).stage);
    if (stageDifference) return stageDifference;
    return a.created_at.localeCompare(b.created_at) || a.id - b.id;
  });
}

export function filterAndSortTracks(
  tracks: Track[],
  query: string,
  state: TrackState | "all",
  sortKey: TrackSortKey,
  direction: TrackSortDirection,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = tracks.filter((track) => {
    if (state !== "all" && track.state !== state) return false;
    if (!normalizedQuery) return true;
    return [track.artist, track.title, track.mix_version ?? "", track.error ?? "", track.state]
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  });
  const priority = new Map(prioritizeActionableTracks(filtered).map((track, index) => [track.id, index]));
  const compare = (left: Track, right: Track) => {
    if (sortKey === "priority") {
      return (priority.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (priority.get(right.id) ?? Number.MAX_SAFE_INTEGER)
        || right.updated_at.localeCompare(left.updated_at);
    }
    if (sortKey === "status") return getWorkflowMeta(left).statusLabel.localeCompare(getWorkflowMeta(right).statusLabel);
    if (sortKey === "updated" || sortKey === "created") {
      const leftDate = sortKey === "updated" ? left.updated_at : left.created_at;
      const rightDate = sortKey === "updated" ? right.updated_at : right.created_at;
      return (Date.parse(leftDate) || 0) - (Date.parse(rightDate) || 0);
    }
    return left[sortKey].localeCompare(right[sortKey]);
  };
  return filtered.sort((left, right) => {
    const result = compare(left, right);
    return (direction === "desc" ? -result : result) || left.id - right.id;
  });
}

function defaultFilter(view: WorkQueueView): PreparationFilter {
  if (view === "running") return "running";
  if (view === "ready_to_dj") return "done";
  return "needs_attention";
}

function fallbackStage(track: Track): PrepareStage {
  const stage = getWorkflowMeta(track).stage;
  return stage === "done" ? "rekordbox" : stage;
}

function localPath(path: string, from?: string, to?: string) {
  const normalized = path.replace(/^file:\/\/localhost\//i, "").replace(/^file:\/\/\//i, "").replace(/\\/g, "/");
  if (!from || !to) return normalized;
  const normalizedFrom = from.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedTo = to.replace(/\\/g, "/").replace(/\/$/, "");
  return normalized.startsWith(normalizedFrom) ? normalizedTo + normalized.slice(normalizedFrom.length) : normalized;
}

interface PrepareViewProps {
  stage: PrepareStage;
  queueView: WorkQueueView;
  selectedTrackId: number | null;
  onStageChange: (stage: PrepareStage) => void;
  onSelectedTrackChange: (trackId: number | null) => void;
  pathMapFrom?: string;
  pathMapTo?: string;
}

export default function PrepareView({ stage, queueView, selectedTrackId, onStageChange, onSelectedTrackChange, pathMapFrom, pathMapTo }: PrepareViewProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [filter, setFilter] = useState<PreparationFilter>(() => defaultFilter(queueView));
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [trackQuery, setTrackQuery] = useState("");
  const [trackState, setTrackState] = useState<TrackState | "all">("all");
  const [sortKey, setSortKey] = useState<TrackSortKey>("updated");
  const [sortDirection, setSortDirection] = useState<TrackSortDirection>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [moveTarget, setMoveTarget] = useState<TrackState>("requested");
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [fallbackOpen, setFallbackOpen] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    return api.listTracks().then(setTracks).catch((reason) => setError(String(reason))).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const handleDataChanged = () => { void load(); };
    window.addEventListener(WORKBENCH_DATA_CHANGED_EVENT, handleDataChanged);
    return () => window.removeEventListener(WORKBENCH_DATA_CHANGED_EVENT, handleDataChanged);
  }, []);
  useEffect(() => {
    setFilter(defaultFilter(queueView));
    setStageFilter("all");
    setSortKey("updated");
    setSortDirection("desc");
  }, [queueView]);

  const selectedTrack = tracks.find((track) => track.id === selectedTrackId) ?? null;
  const baseVisibleTracks = useMemo(() => filterPreparationTracks(tracks, filter, stageFilter), [filter, stageFilter, tracks]);
  const visibleTracks = useMemo(() => filterAndSortTracks(baseVisibleTracks, trackQuery, trackState, sortKey, sortDirection), [baseVisibleTracks, sortDirection, sortKey, trackQuery, trackState]);
  const actionableTracks = useMemo(() => prioritizeActionableTracks(visibleTracks), [visibleTracks]);
  const orderedTracks = visibleTracks;
  const selectedTracks = tracks.filter((track) => selectedIds.has(track.id));
  const activeStage = STAGES.find((item) => item.id === stage) ?? STAGES[0];
  const counts = new Map(FILTERS.map((item) => [item.id, tracks.filter((track) => preparationBucket(track) === item.id).length]));

  const setBusy = (ids: number[], busy: boolean) => setBusyIds((current) => {
    const next = new Set(current);
    ids.forEach((id) => busy ? next.add(id) : next.delete(id));
    return next;
  });

  const runOperation = async (targets: Track[], operation: (track: Track) => Promise<unknown>) => {
    if (!targets.length) return;
    const ids = targets.map((track) => track.id);
    setBusy(ids, true);
    setError(null);
    try {
      await Promise.all(targets.map(operation));
      await load();
    } catch (reason) {
      const message = String(reason);
      await load();
      setError(message);
    } finally {
      setBusy(ids, false);
    }
  };

  const showFallback = (track: Track) => {
    onSelectedTrackChange(track.id);
    onStageChange(fallbackStage(track));
    setFallbackOpen(true);
  };

  const runPrimaryAction = async (track: Track) => {
    const action = getWorkflowMeta(track).nextAction.id;
    const operations: Partial<Record<TrackActionId, (item: Track) => Promise<unknown>>> = {
      search: (item) => api.searchTrack(item.id),
      loose_search: (item) => api.searchTrackLoose(item.id),
      download: (item) => api.startDownload(item.id),
      monitor_download: (item) => api.pollDownload(item.id),
      convert: (item) => api.convertTrack(item.id),
      quality_check: (item) => api.runQualityCheck(item.id),
      retry_quality: (item) => api.runQualityCheck(item.id),
      tag: (item) => api.tagTrack(item.id),
      send_to_rekordbox: (item) => api.finishRekordbox(item.id),
      reveal: (item) => {
        const path = item.dj_path || item.archive_path || item.downloaded_path;
        return path ? api.openFolder(localPath(path, pathMapFrom, pathMapTo)) : Promise.reject(new Error("No file path is recorded for this track."));
      },
    };
    const operation = operations[action];
    if (operation) await runOperation([track], operation);
    else showFallback(track);
  };

  const handleMatchingAction = async (track: Track, action: InspectorMatchingAction) => {
    setBusy([track.id], true);
    setError(null);
    try {
      if (action.id === "approve") {
        await api.approveCandidate(track.id, action.candidate.candidate.username, action.candidate.candidate.filename);
      } else if (action.id === "loose_search") {
        await api.searchTrackLoose(track.id);
      } else if (action.id === "search_again") {
        await api.searchTrack(track.id);
      } else if (action.id === "mark_unavailable") {
        await api.updateTrackState(track.id, "not_found");
      } else if (action.id === "edit_query") {
        await api.updateTrack(track.id, action.artist, action.title, action.mixVersion);
      }

      const latest = await api.listTracks();
      setTracks(latest);
      if (action.id === "approve") {
        const next = prioritizeActionableTracks(filterPreparationTracks(latest, filter, stageFilter)).find((item) => item.id !== track.id);
        onSelectedTrackChange(next?.id ?? null);
      }
    } catch (reason) {
      await load();
      setError(String(reason));
    } finally {
      setBusy([track.id], false);
    }
  };

  const handlePipelineAction = async (track: Track, action: InspectorPipelineAction) => {
    if (action.id === "move_back" && !window.confirm(`Move ${track.artist ? `${track.artist} – ` : ""}${track.title} back to ${action.label}? Later-stage results may need to be repeated.`)) return;
    const operations: Record<Exclude<InspectorPipelineAction["id"], "move_back">, () => Promise<unknown>> = {
      cancel_download: () => api.cancelDownload(track.id),
      poll_download: () => api.pollDownload(track.id),
      retry_download: () => api.startDownload(track.id),
      retry_quality: () => api.runQualityCheck(track.id),
      choose_another_candidate: () => api.updateTrackState(track.id, "matched"),
      mark_tagged: () => api.updateTrackState(track.id, "ready_for_rekordbox"),
      copy_to_rekordbox: () => api.finishRekordbox(track.id),
      reveal: () => {
        const path = track.dj_path || track.archive_path || track.downloaded_path;
        return path ? api.openFolder(localPath(path, pathMapFrom, pathMapTo)) : Promise.reject(new Error("No file path is recorded for this track."));
      },
    };
    const operation = action.id === "move_back" ? () => api.updateTrackState(track.id, action.state) : operations[action.id];
    await runOperation([track], operation);
  };

  const handleMenuAction = async (track: Track, action: TrackMenuAction) => {
    if (action === "retry") return runPrimaryAction(track);
    if (action === "reveal") {
      const path = track.dj_path || track.archive_path || track.downloaded_path;
      if (path) await runOperation([track], () => api.openFolder(localPath(path, pathMapFrom, pathMapTo)));
      return;
    }
    if (action === "delete") {
      if (!window.confirm(`Delete ${track.artist ? `${track.artist} – ` : ""}${track.title} from the workbench?`)) return;
      await runOperation([track], (item) => api.deleteTrack(item.id));
      onSelectedTrackChange(null);
      return;
    }
    if (action === "move_stage") {
      setSelectedIds(new Set([track.id]));
      document.querySelector<HTMLSelectElement>("#batch-stage-target")?.focus();
      return;
    }
    showFallback(track);
  };

  const runBatch = (kind: "search" | "loose" | "download" | "quality" | "move") => {
    if (kind === "search") return runOperation(selectedTracks.filter((track) => track.state === "requested" && !track.search_job_id), (track) => api.searchTrack(track.id));
    if (kind === "loose") return runOperation(selectedTracks.filter((track) => track.state === "not_found" || (track.state === "requested" && Boolean(track.search_job_id))), (track) => api.searchTrackLoose(track.id));
    if (kind === "download") return runOperation(selectedTracks.filter((track) => track.state === "approved"), (track) => api.startDownload(track.id));
    if (kind === "quality") return runOperation(selectedTracks.filter((track) => ["downloaded", "converted", "quality_failed"].includes(track.state)), (track) => api.runQualityCheck(track.id));
    return runOperation(selectedTracks, (track) => api.updateTrackState(track.id, moveTarget)).then(() => setSelectedIds(new Set()));
  };

  const closeInspector = () => {
    const id = selectedTrackId;
    onSelectedTrackChange(null);
    if (id !== null) window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-track-id="${id}"] .workbench-track-identity`)?.focus());
  };

  return (
    <div className="view prepare-view work-queue-view">
      <header className="work-queue-heading">
        <div className="view-heading"><h2>Prepare</h2><p>Work the highest-priority decisions without losing your place.</p></div>
        <button className="button primary" type="button" onClick={() => actionableTracks[0] && runPrimaryAction(actionableTracks[0])} disabled={!actionableTracks.length || loading}>{actionableTracks.length ? `Process ${actionableTracks.length} track${actionableTracks.length === 1 ? "" : "s"} needing action` : "No actions in this view"}</button>
      </header>
      {error && <div className="inline-error" role="alert"><span>{error}</span><button type="button" onClick={load}>Reload</button></div>}

      <div className="work-queue-metrics" aria-label="Preparation filters">
        {FILTERS.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} title={item.description}><strong>{loading ? "–" : counts.get(item.id)}</strong><span>{item.label}</span><small>{item.description}</small></button>)}
        <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")} title="Every imported track, including completed tracks"><strong>{loading ? "–" : tracks.length}</strong><span>All tracks</span><small>Every imported track.</small></button>
      </div>

      <nav className="prepare-stage-tabs" aria-label="Secondary stage filters">
        <button type="button" aria-current={stageFilter === "all" ? "step" : undefined} onClick={() => setStageFilter("all")}>All stages<span>{tracks.length}</span></button>
        {STAGES.map((item) => <button key={item.id} type="button" aria-current={stageFilter === item.id ? "step" : undefined} title={item.description} onClick={() => { setStageFilter(item.id); onStageChange(item.id); }}>{item.label}<span>{tracks.filter((track) => getWorkflowMeta(track).stage === item.id).length}</span></button>)}
      </nav>
      <p className="work-queue-stage-description">{stageFilter === "all" ? "All preparation stages, ordered by urgency and next action." : STAGES.find((item) => item.id === stageFilter)?.description}</p>

      <div className="workbench-table-toolbar" aria-label="Filter and sort tracks">
        <label className="workbench-table-search"> <span>Filter tracks</span><input value={trackQuery} onChange={(event) => setTrackQuery(event.target.value)} placeholder="Artist, title, mix, status…" /></label>
        <label className="workbench-table-select"><span>Status</span><select value={trackState} onChange={(event) => setTrackState(event.target.value as TrackState | "all")}><option value="all">All statuses</option>{Array.from(new Set(tracks.map((track) => track.state))).sort().map((state) => <option key={state} value={state}>{getWorkflowMeta({ state } as Track).statusLabel}</option>)}</select></label>
        <label className="workbench-table-select"><span>Sort by</span><select value={sortKey} onChange={(event) => setSortKey(event.target.value as TrackSortKey)}><option value="priority">Priority</option><option value="artist">Artist</option><option value="title">Title</option><option value="status">Status</option><option value="updated">Last updated</option><option value="created">Date added</option></select></label>
        <button className="workbench-sort-direction" type="button" onClick={() => setSortDirection((current) => current === "asc" ? "desc" : "asc")} aria-label={`Sort ${sortDirection === "asc" ? "descending" : "ascending"}`}>{sortDirection === "asc" ? "↑ Ascending" : "↓ Descending"}</button>
        {(trackQuery || trackState !== "all") && <button className="workbench-clear-filters" type="button" onClick={() => { setTrackQuery(""); setTrackState("all"); }}>Clear</button>}
        <span className="workbench-table-result-count">{orderedTracks.length} of {baseVisibleTracks.length} shown</span>
      </div>

      {selectedIds.size > 0 && <div className="work-queue-batch" aria-label="Batch actions">
        <strong>{selectedIds.size} selected</strong><button type="button" onClick={() => runBatch("search")}>Search</button><button type="button" onClick={() => runBatch("loose")}>Loose search</button><button type="button" onClick={() => runBatch("download")}>Start downloads</button><button type="button" onClick={() => runBatch("quality")}>Run quality checks</button>
        <label htmlFor="batch-stage-target">Move to</label><select id="batch-stage-target" value={moveTarget} onChange={(event) => setMoveTarget(event.target.value as TrackState)}>{STAGES.flatMap((item) => item.states).map((state) => <option key={state} value={state}>{state.replace(/_/g, " ")}</option>)}</select><button type="button" onClick={() => runBatch("move")}>Apply stage</button><button type="button" onClick={() => setSelectedIds(new Set())}>Clear selection</button>
      </div>}

      <div className="work-queue-layout">
        <section className="work-queue-list" aria-label="Prioritized track queue">
          <div className="work-queue-columns" aria-hidden="true"><span /><span>Track</span><span>Mix</span><span>Status</span><span>Blocker</span><span>Updated</span><span>Next action</span><span /></div>
          {loading ? <p className="work-queue-empty">Loading prioritized queue…</p> : orderedTracks.length ? orderedTracks.map((track) => <TrackRow key={track.id} track={track} metadata={getWorkflowMeta(track)} selected={selectedTrackId === track.id} checked={selectedIds.has(track.id)} busy={busyIds.has(track.id)} onCheckedChange={(checked) => setSelectedIds((current) => { const next = new Set(current); checked ? next.add(track.id) : next.delete(track.id); return next; })} onOpen={() => onSelectedTrackChange(track.id)} onPrimaryAction={() => runPrimaryAction(track)} onMenuAction={(action) => handleMenuAction(track, action)} />) : <p className="work-queue-empty">No tracks match this queue and stage filter.</p>}
          {orderedTracks.some((track) => track.state === "not_found" || (track.state === "requested" && track.search_job_id)) && <details className="work-queue-help"><summary>No search results?</summary><p>Use Loose search to broaden the query. Edit the artist, title, or mix in the full Find files workspace if the result is still empty.</p></details>}
        </section>
        <TrackInspector track={selectedTrack} pathMapFrom={pathMapFrom} pathMapTo={pathMapTo} busy={selectedTrack ? busyIds.has(selectedTrack.id) : false} error={error} onClose={closeInspector} onPrimaryAction={runPrimaryAction} onMenuAction={handleMenuAction} onMatchingAction={handleMatchingAction} onPipelineAction={handlePipelineAction} />
      </div>

      <section className="legacy-stage-fallback" aria-labelledby="fallback-stage-title">
        <button type="button" className="legacy-stage-toggle" aria-expanded={fallbackOpen} onClick={() => setFallbackOpen((open) => !open)}><span><strong id="fallback-stage-title">Full {activeStage.label} workspace</strong><small>{activeStage.description}</small></span><span>{fallbackOpen ? "Hide" : "Open"}</span></button>
        {fallbackOpen && <div className="legacy-stage-content">{stage === "find" ? <ReviewView states={FIND_STATES} onTrackChanged={(updated) => setTracks((current) => current.map((track) => track.id === updated.id ? updated : track))} /> : stage === "match" ? <ReviewView states={MATCH_STATES} onTrackChanged={(updated) => setTracks((current) => current.map((track) => track.id === updated.id ? updated : track))} /> : <DownloadView states={activeStage.states} embedded selectedTrackId={selectedTrackId ?? undefined} onTrackChanged={(updated) => setTracks((current) => current.map((track) => track.id === updated.id ? updated : track))} emptyMessage={`No tracks are ready for ${activeStage.label.toLowerCase()} yet.`} />}</div>}
      </section>
    </div>
  );
}
