import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Disc3,
  Inbox,
  Library,
  Settings,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type WorkbenchView = "inbox" | "needs_attention" | "running" | "ready_to_dj" | "library" | "discover" | "settings";

export interface WorkbenchCounts {
  inbox: number;
  needsAttention: number;
  running: number;
  readyToDj: number;
  library: number;
}

interface WorkbenchRailProps {
  currentView: WorkbenchView;
  counts: WorkbenchCounts;
  activityOpen: boolean;
  onNavigate: (view: WorkbenchView) => void;
  onToggleActivity: () => void;
}

interface NavigationItem {
  id: WorkbenchView;
  label: string;
  icon: LucideIcon;
  countKey?: keyof WorkbenchCounts;
  shortcut?: number;
}

const NAVIGATION_ITEMS: NavigationItem[] = [
  { id: "inbox", label: "Inbox", icon: Inbox, countKey: "inbox", shortcut: 1 },
  { id: "needs_attention", label: "Needs attention", icon: AlertCircle, countKey: "needsAttention", shortcut: 3 },
  { id: "running", label: "Running", icon: Activity, countKey: "running" },
  { id: "ready_to_dj", label: "Ready to DJ", icon: CheckCircle2, countKey: "readyToDj" },
  { id: "library", label: "Library", icon: Library, countKey: "library", shortcut: 2 },
  { id: "discover", label: "Discover", icon: Sparkles, shortcut: 4 },
  { id: "settings", label: "Settings", icon: Settings, shortcut: 5 },
];

export default function WorkbenchRail({ currentView, counts, activityOpen, onNavigate, onToggleActivity }: WorkbenchRailProps) {
  return (
    <aside className="workbench-rail">
      <div className="workbench-brand">
        <span className="brand-mark" />
        <span>DJ PREP</span>
        <small>Setlist Workbench</small>
      </div>
      <nav className="workbench-nav" aria-label="Workbench navigation">
        {NAVIGATION_ITEMS.map(({ id, label, icon: Icon, countKey, shortcut }) => (
          <button
            key={id}
            type="button"
            aria-current={currentView === id ? "page" : undefined}
            aria-label={shortcut ? `${label}, shortcut ${shortcut}` : label}
            title={shortcut ? `${label} (${shortcut})` : label}
            onClick={() => onNavigate(id)}
          >
            <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
            <span className="workbench-nav-label">{label}</span>
            {countKey && <span className="workbench-nav-count" aria-label={`${counts[countKey]} tracks`}>{counts[countKey]}</span>}
            {shortcut && <kbd>{shortcut}</kbd>}
          </button>
        ))}
      </nav>
      <button
        type="button"
        className="activity-log-control"
        aria-expanded={activityOpen}
        aria-controls="activity-drawer"
        onClick={onToggleActivity}
      >
        <Disc3 aria-hidden="true" size={17} strokeWidth={1.8} />
        <span>Activity log</span>
      </button>
    </aside>
  );
}
