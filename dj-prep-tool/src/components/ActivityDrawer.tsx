import { useEffect, useRef } from "react";
import { GripHorizontal, X } from "lucide-react";
import type { LogEntry } from "../lib/types";

interface ActivityDrawerProps {
  entries: LogEntry[];
  open: boolean;
  onClose: () => void;
}

export default function ActivityDrawer({ entries, open, onClose }: ActivityDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origLeft: number; origTop: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;

  const onDragStart = (event: React.MouseEvent) => {
    event.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    panel.style.transform = "none";
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    dragRef.current = { startX: event.clientX, startY: event.clientY, origLeft: rect.left, origTop: rect.top };

    const onMove = (moveEvent: MouseEvent) => {
      if (!dragRef.current || !panelRef.current) return;
      const left = dragRef.current.origLeft + moveEvent.clientX - dragRef.current.startX;
      const top = dragRef.current.origTop + moveEvent.clientY - dragRef.current.startY;
      panelRef.current.style.left = `${Math.max(0, Math.min(window.innerWidth - 120, left))}px`;
      panelRef.current.style.top = `${Math.max(0, Math.min(window.innerHeight - 48, top))}px`;
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="activity-drawer-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section id="activity-drawer" ref={panelRef} className="activity-drawer" role="dialog" aria-modal="true" aria-labelledby="activity-drawer-title">
        <header className="activity-drawer-header" onMouseDown={onDragStart}>
          <GripHorizontal aria-hidden="true" size={18} />
          <strong id="activity-drawer-title">Activity log</strong>
          <span>{entries.length} recent entries</span>
          <button type="button" onMouseDown={(event) => event.stopPropagation()} onClick={onClose} aria-label="Close activity log">
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <div className="activity-drawer-list">
          {entries.length ? [...entries].reverse().map((entry, index) => (
            <div className="activity-drawer-entry" key={`${index}-${entry.message}`}>
              <time>{entry.timestamp}</time>
              <span>{entry.message}</span>
            </div>
          )) : <p>No activity yet.</p>}
        </div>
      </section>
    </div>
  );
}
