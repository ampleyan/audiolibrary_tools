import { MoreHorizontal } from "lucide-react";
import type { TrackRow as Track, WorkflowMetadata } from "../lib/types";
import TrackStatusBadge from "./TrackStatusBadge";

export type TrackMenuAction = "edit" | "retry" | "move_stage" | "reveal" | "delete";

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
}

function trackName(track: Track) {
  return track.artist ? `${track.artist} – ${track.title}` : track.title;
}

function formatUpdatedAt(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

const MENU_ACTIONS: Array<{ id: TrackMenuAction; label: string }> = [
  { id: "edit", label: "Edit details" },
  { id: "retry", label: "Retry action" },
  { id: "move_stage", label: "Move stage" },
  { id: "reveal", label: "Reveal file" },
  { id: "delete", label: "Delete" },
];

export default function TrackRow({ track, metadata, selected, checked = false, busy = false, onCheckedChange, onOpen, onPrimaryAction, onMenuAction }: TrackRowProps) {
  const name = trackName(track);

  return (
    <div className={`workbench-track-row${selected ? " is-selected" : ""}${busy ? " is-busy" : ""}`} aria-selected={selected} data-track-id={track.id}>
      <label className="workbench-track-check">
        <span className="sr-only">Select {name}</span>
        <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange?.(event.target.checked)} disabled={busy || !onCheckedChange} />
      </label>
      <button className="workbench-track-identity" type="button" onClick={onOpen} disabled={busy}>
        <strong>{track.artist || "Unknown artist"}</strong>
        <span>{track.title}</span>
      </button>
      <span className="workbench-track-mix" title={track.mix_version ?? undefined}>{track.mix_version || "—"}</span>
      <TrackStatusBadge metadata={metadata} />
      <span className={`workbench-track-blocker${track.error ? " has-error" : ""}`} title={track.error ?? undefined}>{track.error || "No blocker"}</span>
      <time className="workbench-track-updated" dateTime={track.updated_at} title={track.updated_at}>{formatUpdatedAt(track.updated_at)}</time>
      <button className="workbench-track-primary" type="button" onClick={onPrimaryAction} disabled={busy || !metadata.actionable}>{metadata.nextAction.label}</button>
      <details className="workbench-track-menu">
        <summary aria-label={`More actions for ${name}`}><MoreHorizontal aria-hidden="true" size={16} /></summary>
        <div role="menu">
          {MENU_ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              className={action.id === "delete" ? "destructive" : undefined}
              aria-label={action.id === "delete" ? `Delete ${name}` : `${action.label} for ${name}`}
              onClick={() => onMenuAction(action.id)}
              disabled={busy || (action.id === "reveal" && !track.downloaded_path && !track.archive_path && !track.dj_path)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
