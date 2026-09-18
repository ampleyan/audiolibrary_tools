import { AlertTriangle, CircleHelp, CheckCircle2, Copy, MoreHorizontal } from "lucide-react";
import type { TrackRow as Track, WorkflowMetadata } from "../lib/types";
import TrackStatusBadge from "./TrackStatusBadge";

export type TrackMenuAction = "edit" | "retry" | "move_stage" | "reveal" | "delete";

export interface TrackDownloadProgress {
  bytesOnDisk: number | null;
  bytesTotal: number | null;
  speed: number | null;
}

interface TrackRowProps {
  track: Track;
  metadata: WorkflowMetadata;
  selected: boolean;
  checked?: boolean;
  busy?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onOpen: () => void;
  onPrimaryAction: () => void;
  onMenuAction: (action: TrackMenuAction) => void;
  downloadProgress?: TrackDownloadProgress;
  showSelection?: boolean;
  showMenu?: boolean;
}

function trackName(track: Track) {
  return track.artist ? `${track.artist} – ${track.title}` : track.title;
}

function formatUpdatedAt(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

const MENU_ACTIONS: Array<{ id: TrackMenuAction; label: string }> = [
  { id: "edit", label: "Edit details" },
  { id: "retry", label: "Retry action" },
  { id: "move_stage", label: "Move stage" },
  { id: "reveal", label: "Reveal file" },
  { id: "delete", label: "Delete" },
];

export function BlockerIndicator({ track }: { track: Track }) {
  if (!track.error) return <span className="workbench-blocker-icon clear" title="No blocker" aria-label="No blocker"><CheckCircle2 aria-hidden="true" size={14} /></span>;
  const duplicate = track.error.toLowerCase().includes("duplicate");
  const notFound = track.state === "not_found";
  const label = duplicate ? "Duplicate track" : notFound ? "Search returned no file" : track.error;
  const Icon = duplicate ? Copy : notFound ? CircleHelp : AlertTriangle;
  return <span className={`workbench-blocker-icon ${duplicate || notFound ? "attention" : "error"}`} title={label} aria-label={label}><Icon aria-hidden="true" size={14} /></span>;
}

export default function TrackRow({ track, metadata, selected, checked = false, busy = false, onCheckedChange, onOpen, onPrimaryAction, onMenuAction, downloadProgress, showSelection = true, showMenu = true }: TrackRowProps) {
  const name = trackName(track);
  const hasProgress = track.state === "downloading" && downloadProgress?.bytesOnDisk != null && downloadProgress.bytesTotal != null && downloadProgress.bytesTotal > 0;
  const progressPercent = hasProgress ? Math.max(0, Math.min(100, Math.round((downloadProgress.bytesOnDisk! / downloadProgress.bytesTotal!) * 100))) : null;

  return (
    <div className={`workbench-track-row${selected ? " is-selected" : ""}${busy ? " is-busy" : ""}${!track.artist ? " no-artist" : ""}`} aria-selected={selected} data-track-id={track.id}>
      {showSelection ? <label className="workbench-track-check"><span className="sr-only">Select {name}</span><input type="checkbox" checked={checked} onChange={(event) => onCheckedChange?.(event.target.checked)} disabled={busy || !onCheckedChange} /></label> : <span aria-hidden="true" />}
      <button className="workbench-track-identity" type="button" onClick={onOpen} disabled={busy}>
        <strong>{track.artist || "Unknown artist"}</strong>
        <span>{track.title}</span>
        {hasProgress && <span className="workbench-track-progress"><progress max="100" value={progressPercent ?? 0} aria-label={`Download progress for ${name}`} aria-valuetext={`${progressPercent}% downloaded`} /><span className="workbench-track-progress-summary"><strong>{progressPercent}%</strong><span>{formatBytes(downloadProgress.bytesOnDisk!)} / {formatBytes(downloadProgress.bytesTotal!)}{downloadProgress.speed ? ` · ${formatBytes(downloadProgress.speed)}/s` : ""}</span></span></span>}
        {track.state === "downloading" && !hasProgress && <span className="workbench-track-progress pending">{downloadProgress?.bytesOnDisk != null ? `${formatBytes(downloadProgress.bytesOnDisk)} downloaded` : "Waiting for download data…"}</span>}
      </button>
      <span className="workbench-track-mix" title={track.mix_version ?? undefined}>{track.mix_version || "—"}</span>
      <TrackStatusBadge metadata={metadata} />
      <BlockerIndicator track={track} />
      <time className="workbench-track-updated" dateTime={track.updated_at} title={track.updated_at}>{formatUpdatedAt(track.updated_at)}</time>
      <button className="workbench-track-primary" type="button" onClick={onPrimaryAction} disabled={busy || !metadata.actionable}>{metadata.nextAction.label}</button>
      {showMenu ? <details className="workbench-track-menu"><summary aria-label={`More actions for ${name}`}><MoreHorizontal aria-hidden="true" size={16} /></summary><div role="menu">{MENU_ACTIONS.map((action) => <button key={action.id} type="button" role="menuitem" className={action.id === "delete" ? "destructive" : undefined} aria-label={action.id === "delete" ? `Delete ${name}` : `${action.label} for ${name}`} onClick={() => onMenuAction(action.id)} disabled={busy || (action.id === "reveal" && !track.downloaded_path && !track.archive_path && !track.dj_path)}>{action.label}</button>)}</div></details> : <span aria-hidden="true" />}
    </div>
  );
}
