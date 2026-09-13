import { Fragment, useEffect, useState } from "react";
import { api } from "./lib/api";
import type { PublicSettings } from "./lib/types";
import DownloadView from "./views/DownloadView";
import ImportView from "./views/ImportView";
import PipelineView from "./views/PipelineView";
import ReviewView from "./views/ReviewView";
import SetupView from "./views/SetupView";

type Tab = "import" | "review" | "downloads" | "pipeline" | "setup";

const TABS: { id: Tab; label: string }[] = [
  { id: "import", label: "Import" },
  { id: "review", label: "Review" },
  { id: "downloads", label: "Download & check" },
  { id: "pipeline", label: "Overview" },
];

export default function App() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [tab, setTab] = useState<Tab>("import");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [trackCounts, setTrackCounts] = useState({ total: 0, review: 0, downloads: 0, ready: 0 });

  const loadCounts = () => api.listTracks().then((tracks) => setTrackCounts({
    total: tracks.length,
    review: tracks.filter((t) => t.state === "requested" || t.state === "needs_review" || t.state === "matched").length,
    downloads: tracks.filter((t) => !["requested", "needs_review", "matched", "dj_ready"].includes(t.state)).length,
    ready: tracks.filter((t) => t.state === "dj_ready").length,
  })).catch(() => {});

  const loadSettings = () =>
    api
      .getSettings()
      .then(setSettings)
      .catch((e) => setLoadError(String(e)));

  useEffect(() => {
    loadSettings();
    loadCounts();
    const refreshTimer = window.setInterval(loadCounts, 5000);
    return () => window.clearInterval(refreshTimer);
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
        {TABS.map(({ id, label }) => (
          <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        </nav>
        <div>
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
        <div className="workflow-strip" aria-label="Preparation workflow">
          {[{ id: "import" as Tab, n: "1", label: "Import", count: trackCounts.total }, { id: "review" as Tab, n: "2", label: "Review matches", count: trackCounts.review }, { id: "downloads" as Tab, n: "3", label: "Download & check", count: trackCounts.downloads }, { id: "pipeline" as Tab, n: "4", label: "Ready", count: trackCounts.ready }].map((step, index, steps) => (
            <Fragment key={step.id}>
              <button className={`workflow-step ${tab === step.id ? "active" : ""} ${index < ["import", "review", "downloads", "pipeline"].indexOf(tab) ? "done" : ""}`} onClick={() => setTab(step.id)}>
                <span className="workflow-dot">{step.n}</span><strong>{step.label}</strong><span>{step.count}</span>
              </button>
              {index < steps.length - 1 && <span className="workflow-line" />}
            </Fragment>
          ))}
        </div>
      </header>

      <main>
        {tab === "import" && <ImportView onNavigate={(t) => setTab(t as Tab)} />}
        {tab === "review" && <ReviewView />}
        {tab === "downloads" && <DownloadView />}
        {tab === "pipeline" && <PipelineView />}
        {tab === "setup" && (
          <SetupView
            settings={settings}
            onSaved={() => {
              loadSettings();
              setTab("import");
            }}
          />
        )}
      </main>
    </div>
  );
}
