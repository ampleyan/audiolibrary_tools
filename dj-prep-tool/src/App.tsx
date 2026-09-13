import { useEffect, useState } from "react";
import { api } from "./lib/api";
import type { PublicSettings } from "./lib/types";
import DownloadView from "./views/DownloadView";
import ImportView from "./views/ImportView";
import PipelineView from "./views/PipelineView";
import ReviewView from "./views/ReviewView";
import SetupView from "./views/SetupView";

type Tab = "import" | "review" | "downloads" | "pipeline" | "setup";

const TABS: { id: Tab; label: string }[] = [
  { id: "pipeline", label: "Pipeline" },
  { id: "import", label: "Add tracks" },
  { id: "review", label: "Review" },
  { id: "downloads", label: "Download & check" },
];

export default function App() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [tab, setTab] = useState<Tab>("pipeline");
  const [loadError, setLoadError] = useState<string | null>(null);

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
              setTab("pipeline");
            }}
          />
        )}
      </main>
    </div>
  );
}
