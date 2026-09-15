import { useEffect, useRef, useState } from "react";
import { api } from "./lib/api";
import type { LogEntry, PublicSettings, SimilarTrack } from "./lib/types";
import DiscoveryView from "./views/DiscoveryView";
import ImportView from "./views/ImportView";
import LibraryView from "./views/LibraryView";

import PrepareView, { type PrepareStage } from "./views/PrepareView";
import SetupView from "./views/SetupView";

type Tab = "import" | "library" | "prepare" | "discover" | "setup";

function getVideoId(url: string) {
  return url.match(/[?&]v=([^&]+)/)?.[1] ?? url.match(/youtu\.be\/([^?]+)/)?.[1] ?? null;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "import", label: "Import" },
  { id: "library", label: "Library" },
  { id: "prepare", label: "Prepare" },
  { id: "discover", label: "Discover" },
  { id: "setup", label: "Settings" },
];

export default function App() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [tab, setTab] = useState<Tab>("prepare");
  const [prepareStage, setPrepareStage] = useState<PrepareStage>("find");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [player, setPlayer] = useState<{ tracks: SimilarTrack[]; index: number } | null>(null);
  const logPanelRef = useRef<HTMLDivElement>(null);
  const logDragRef = useRef<{ startX: number; startY: number; origLeft: number; origTop: number } | null>(null);

  const onLogDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = logPanelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.transform = "none";
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    logDragRef.current = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top };
    const onMove = (me: MouseEvent) => {
      if (!logDragRef.current || !logPanelRef.current) return;
      const dx = me.clientX - logDragRef.current.startX;
      const dy = me.clientY - logDragRef.current.startY;
      logPanelRef.current.style.left = `${Math.max(0, Math.min(window.innerWidth - 120, logDragRef.current.origLeft + dx))}px`;
      logPanelRef.current.style.top = `${Math.max(0, Math.min(window.innerHeight - 48, logDragRef.current.origTop + dy))}px`;
    };
    const onUp = () => { logDragRef.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const [playerMessage, setPlayerMessage] = useState<string | null>(null);
  const navigate = (nextTab: string) => {
    if (nextTab === "review") {
      setPrepareStage("find");
      setTab("prepare");
      return;
    }
    if (nextTab === "downloads") {
      setPrepareStage("download");
      setTab("prepare");
      return;
    }
    setTab(nextTab as Tab);
  };

  useEffect(() => {
    const shortcuts: Record<string, Tab> = {
      "1": "import",
      "2": "library",
      "3": "prepare",
      "4": "discover",
      "5": "setup",
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#f87171", fontSize: 14, background: "#09090d" }}>
        Failed to load settings: {loadError}
      </div>
    );
  }

  if (!settings) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#6f8293", fontSize: 14, background: "#09090d" }}>
        Loading…
      </div>
    );
  }

  if (!settings.setupComplete) {
    return (
      <div className="app-shell">
        <SetupView settings={settings} onSaved={loadSettings} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-top">
          <span className="brand"><span className="brand-mark" />DJ PREP</span>
          <nav className="topnav" aria-label="Main navigation">
            {TABS.map(({ id, label }, index) => (
              <button key={id} title={`${label} (${index + 1})`} aria-label={`${label}, shortcut ${index + 1}`} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
            <button onClick={() => setShowLogs((v) => !v)} style={{ background: "transparent", border: "none", color: showLogs ? "#ff4fa3" : "#5a4552", cursor: "pointer", fontSize: 18, padding: "0 4px", lineHeight: 1, transition: "color .15s" }} title="Logs" aria-label="Toggle logs">
              ≡
            </button>
          </div>
        </div>
      </header>

      <main>
        {tab === "import" && <ImportView onNavigate={navigate} />}

        {tab === "library" && <LibraryView onNavigate={navigate} />}
        {tab === "prepare" && <PrepareView stage={prepareStage} onStageChange={setPrepareStage} pathMapFrom={settings.pathMapFrom} pathMapTo={settings.pathMapTo} />}
        {tab === "discover" && <DiscoveryView onNavigate={navigate} onPlayTrack={(tracks, index) => { setPlayer({ tracks, index }); setPlayerMessage(null); }} />}
        {tab === "setup" && (
          <SetupView
            settings={settings}
            onSaved={() => {
              loadSettings();
              setTab("prepare");
            }}
          />
        )}
      </main>
      {player && <PersistentPlayer player={player} onChange={setPlayer} onStop={() => setPlayer(null)} message={playerMessage} onAdd={async () => {
        const track = player.tracks[player.index];
        if (!track) return;
        try {
          const mix = track.mixVersion ? ` (${track.mixVersion})` : "";
          const added = await api.importText(`${track.artist} - ${track.title}${mix}`);
          setPlayerMessage(added.length ? "Added to Library" : "Already in Library");
        } catch (e) {
          setPlayerMessage(String(e));
        }
      }} />}
      {showLogs && (
        <div role="dialog" aria-modal="true" aria-label="Application logs" style={{ position: "fixed", inset: 0, zIndex: 30, background: "#00000088" }} onClick={(e) => { if (e.target === e.currentTarget) setShowLogs(false); }}>
          <div ref={logPanelRef} style={{ position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)", background: "#120d14", border: "1px solid #352330", borderRadius: 12, width: "min(860px, 94vw)", maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px #000c" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #2d2029", cursor: "grab", userSelect: "none" }} onMouseDown={onLogDragStart}>
              <strong style={{ color: "#f8f4f7", fontSize: 13 }}>⠿ Logs</strong>
              <span style={{ color: "#6f8293", fontSize: 11 }}>{logs.length} recent entries</span>
              <button onMouseDown={(e) => e.stopPropagation()} onClick={() => setShowLogs(false)} style={{ background: "transparent", border: "none", color: "#a48e9b", cursor: "pointer", fontSize: 16, padding: "0 4px", lineHeight: 1 }}>✕</button>
            </div>
            <pre style={{ flex: 1, overflow: "auto", margin: 0, padding: "12px 16px", color: "#d5e6ef", font: "12px/1.7 ui-monospace, SFMono-Regular, Consolas, monospace", whiteSpace: "pre-wrap" }}>
              {logs.length ? [...logs].reverse().map((entry, index) => <div key={`${index}-${entry.message}`} style={{ borderBottom: "1px solid #1e1320", padding: "3px 0" }}><span style={{ color: "#513343", marginRight: 8 }}>{entry.timestamp}</span>{entry.message}</div>) : "No logs yet."}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// Preload the YouTube IFrame API as early as possible so it is ready
// by the time the user clicks play — autoplay with sound requires the
// player to be created synchronously inside a user-gesture call stack.
const ytReady: Promise<void> = new Promise((resolve) => {
  const win = window as unknown as Record<string, unknown>;
  if (win.YT && (win.YT as Record<string, unknown>).Player) { resolve(); return; }
  const prev = win.onYouTubeIframeAPIReady as (() => void) | undefined;
  win.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
  if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  }
});

function PersistentPlayer({ player, onChange, onStop, message, onAdd }: { player: { tracks: SimilarTrack[]; index: number }; onChange: (player: { tracks: SimilarTrack[]; index: number }) => void; onStop: () => void; message: string | null; onAdd: () => Promise<void> }) {
  const track = player.tracks[player.index];
  const videoId = track?.videoUrl ? getVideoId(track.videoUrl) : null;
  const containerRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<YT.Player | null>(null);
  const onChangeRef = useRef(onChange);
  const playerRef = useRef(player);
  const dragRef = useRef<{ startX: number; startY: number; origRight: number; origBottom: number } | null>(null);
  const posRef = useRef<{ right: number; bottom: number }>({ right: 18, bottom: 18 });
  const wrapperRef = useRef<HTMLElement>(null);
  onChangeRef.current = onChange;
  playerRef.current = player;

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = wrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origRight: window.innerWidth - rect.right, origBottom: window.innerHeight - rect.bottom };
    const onMove = (me: MouseEvent) => {
      if (!dragRef.current || !wrapperRef.current) return;
      const dx = me.clientX - dragRef.current.startX;
      const dy = me.clientY - dragRef.current.startY;
      posRef.current = { right: Math.max(0, dragRef.current.origRight - dx), bottom: Math.max(0, dragRef.current.origBottom - dy) };
      wrapperRef.current.style.right = `${posRef.current.right}px`;
      wrapperRef.current.style.bottom = `${posRef.current.bottom}px`;
    };
    const onUp = () => { dragRef.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    ytReady.then(() => {
      if (cancelled || !containerRef.current) return;
      ytPlayerRef.current?.destroy();
      const win = window as unknown as { YT: typeof YT };
      ytPlayerRef.current = new win.YT.Player(containerRef.current, {
        videoId,
        playerVars: { autoplay: 1, rel: 0 },
        events: {
          onStateChange: (event: YT.OnStateChangeEvent) => {
            if (event.data === win.YT.PlayerState.ENDED) {
              const current = playerRef.current;
              if (current.index < current.tracks.length - 1) {
                onChangeRef.current({ ...current, index: current.index + 1 });
              }
            }
          },
        },
      });
    });
    return () => {
      cancelled = true;
      ytPlayerRef.current?.destroy();
      ytPlayerRef.current = null;
    };
  }, [videoId]);

  if (!track || !videoId) return null;
  const hasPrevious = player.index > 0;
  const hasNext = player.index < player.tracks.length - 1;
  return <section ref={wrapperRef} className="persistent-player" aria-label={`Previewing ${track.artist} ${track.title}`}>
    <div className="persistent-player-drag" onMouseDown={onDragStart} title="Drag to move">⠿</div>
    <div className="persistent-player-info"><span>Previewing now</span><strong>{track.artist} – {track.title}</strong><small>{player.index + 1} of {player.tracks.length}</small>{message && <em aria-live="polite">{message}</em>}</div>
    <div className="persistent-player-actions">
      <button type="button" onClick={() => onChange({ ...player, index: player.index - 1 })} disabled={!hasPrevious} aria-label="Play previous similar track">Previous</button>
      <button type="button" onClick={() => onChange({ ...player, index: player.index + 1 })} disabled={!hasNext} aria-label="Play next similar track">Next</button>
      <button type="button" onClick={onAdd}>Add to Library</button>
      <button type="button" onClick={onStop}>Stop</button>
    </div>
    <div ref={containerRef} />
  </section>;
}
