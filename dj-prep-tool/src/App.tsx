import { useEffect, useState } from "react";
import { api } from "./lib/api";
import type { LogEntry, PublicSettings } from "./lib/types";
import DownloadView from "./views/DownloadView";
import DiscoveryView from "./views/DiscoveryView";
import ImportView from "./views/ImportView";
import PipelineView from "./views/PipelineView";
import ReviewView from "./views/ReviewView";
import SetupView from "./views/SetupView";

type Tab = "import" | "review" | "downloads" | "pipeline" | "discover" | "setup";

const TABS: { id: Tab; label: string }[] = [
  { id: "pipeline", label: "Pipeline" },
  { id: "discover", label: "Discover" },
  { id: "import", label: "Add tracks" },
  { id: "review", label: "Review" },
  { id: "downloads", label: "Download & check" },
];

export default function App() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [tab, setTab] = useState<Tab>("pipeline");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    const shortcuts: Record<string, Tab> = {
      "1": "pipeline",
      "2": "discover",
      "3": "import",
      "4": "review",
      "5": "downloads",
      "0": "setup",
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const nextTab = shortcuts[event.key];
      if (!nextTab || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      setTab(nextTab);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!showLogs) return;
    let active = true;
    const loadLogs = () => api.getLogs().then((next) => { if (active) setLogs(next); }).catch(() => {});
    loadLogs();
    const timer = window.setInterval(loadLogs, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [showLogs]);

  const loadSettings = () =>
    api
      .getSettings()
      .then(setSettings)
      .catch((e) => setLoadError(String(e)));

  useEffect(() => {
    loadSettings();
  }, []);

  if (loadError) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          color: "#f87171",
          fontSize: 14,
        }}
      >
        Failed to load settings: {loadError}
      </div>
    );
  }

  if (!settings) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          color: "#4b5563",
          fontSize: 14,
        }}
      >
        Loading…
      </div>
    );
  }

  if (!settings.setupComplete) {
    return (
      <div style={{ background: "#111827", minHeight: "100vh" }}>
        <SetupView settings={settings} onSaved={loadSettings} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-top">
        <span
          className="brand"
        >
          <span className="brand-mark" />DJ PREP
        </span>
        <nav className="topnav" aria-label="Main navigation">
        {TABS.map(({ id, label }, index) => (
          <button key={id} title={`Shortcut: ${index + 1}`} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        </nav>
        <div>
          <label style={{ color: "#8190a0", fontSize: 12, marginRight: 12, userSelect: "none" }}>
            <input type="checkbox" checked={showLogs} onChange={(event) => setShowLogs(event.target.checked)} /> Show logs
          </label>
          <button
            className="settings-button"
            onClick={() => setTab("setup")}
            title="Settings"
            aria-label="Settings"
          >
            ⚙
          </button>
        </div>
        </div>
      </header>

      <main>
        {tab === "import" && <ImportView onNavigate={(t) => setTab(t as Tab)} />}
        {tab === "review" && <ReviewView />}
        {tab === "downloads" && <DownloadView />}
        {tab === "pipeline" && <PipelineView />}
        {tab === "discover" && <DiscoveryView />}
        {tab === "setup" && (
          <SetupView
            settings={settings}
            onSaved={() => {
              loadSettings();
              setTab("pipeline");
            }}
          />
        )}
      </main>
      {showLogs && <section aria-label="Application logs" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 20, background: "#0d131a", borderTop: "1px solid #344454", padding: "10px 18px", boxShadow: "0 -8px 24px #0008" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}><strong style={{ color: "#d5e6ef", fontSize: 12 }}>Logs</strong><span style={{ color: "#6f8293", fontSize: 11 }}>{logs.length} recent entries</span></div>
        <pre style={{ maxHeight: 180, overflow: "auto", margin: 0, color: "#9fb2bf", font: "11px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace", whiteSpace: "pre-wrap" }}>{logs.length ? logs.map((entry, index) => <div key={`${index}-${entry.message}`}>{entry.timestamp && `${entry.timestamp} `}{entry.message}</div>) : "No logs yet."}</pre>
      </section>}
    </div>
  );
}
