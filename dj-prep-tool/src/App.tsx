import { useEffect, useRef, useState } from "react";
import ActivityDrawer from "./components/ActivityDrawer";
import WorkbenchRail from "./components/WorkbenchRail";
import type { WorkbenchCounts, WorkbenchView } from "./components/WorkbenchRail";
import { api } from "./lib/api";
import type { LogEntry, PublicSettings, SimilarTrack } from "./lib/types";
import { getWorkflowMeta } from "./lib/workflow";
import DiscoveryView from "./views/DiscoveryView";
import ImportView from "./views/ImportView";
import LibraryView from "./views/LibraryView";
import PlaylistsView from "./views/PlaylistsView";

import PrepareView, { type PrepareStage } from "./views/PrepareView";
import SetupView from "./views/SetupView";

function getVideoId(url: string) {
  return url.match(/[?&]v=([^&]+)/)?.[1] ?? url.match(/youtu\.be\/([^?]+)/)?.[1] ?? null;
}

const EMPTY_COUNTS: WorkbenchCounts = { inbox: 0, needsAttention: 0, running: 0, readyToDj: 0, library: 0 };

export default function App() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [view, setView] = useState<WorkbenchView>("needs_attention");
  const [prepareStage, setPrepareStage] = useState<PrepareStage>("find");
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [counts, setCounts] = useState<WorkbenchCounts>(EMPTY_COUNTS);
  const [player, setPlayer] = useState<{ tracks: SimilarTrack[]; index: number } | null>(null);
  const [playerMessage, setPlayerMessage] = useState<string | null>(null);

  const selectView = (nextView: WorkbenchView) => {
    if (nextView === "needs_attention") setPrepareStage("find");
    if (nextView === "running") setPrepareStage("download");
    if (nextView === "ready_to_dj") setPrepareStage("rekordbox");
    if (!(["needs_attention", "running", "ready_to_dj"] as WorkbenchView[]).includes(nextView)) setSelectedTrackId(null);
    setView(nextView);
  };

  const navigate = (nextTab: string) => {
    if (nextTab === "review") {
      selectView("needs_attention");
      return;
    }
    if (nextTab === "downloads") {
      selectView("running");
      return;
    }
    const legacyViews: Record<string, WorkbenchView> = {
      import: "inbox",
      library: "library",
      playlists: "playlists",
      prepare: "needs_attention",
      discover: "discover",
      setup: "settings",
    };
    const nextView = legacyViews[nextTab];
    if (nextView) selectView(nextView);
  };

  useEffect(() => {
    const shortcuts: Record<string, WorkbenchView> = {
      "1": "inbox",
      "2": "library",
      "3": "needs_attention",
      "4": "discover",
      "5": "settings",
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const nextView = shortcuts[event.key];
      if (!nextView || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      selectView(nextView);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!settings?.setupComplete) return;
    let active = true;
    const loadCounts = () => api.listTracks().then((tracks) => {
      if (!active) return;
      const next = tracks.reduce<WorkbenchCounts>((result, track) => {
        const bucket = getWorkflowMeta(track).bucket;
        result.library += 1;
        if (bucket === "inbox") result.inbox += 1;
        if (bucket === "needs_attention" || bucket === "inbox") result.needsAttention += 1;
        if (bucket === "running") result.running += 1;
        if (bucket === "ready_to_dj") result.readyToDj += 1;
        return result;
      }, { ...EMPTY_COUNTS });
      setCounts(next);
    }).catch(() => {});
    loadCounts();
    const timer = window.setInterval(loadCounts, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [settings?.setupComplete]);

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
    <div className="app-shell workbench-shell">
      <WorkbenchRail currentView={view} counts={counts} activityOpen={showLogs} onNavigate={selectView} onToggleActivity={() => setShowLogs((open) => !open)} />
      <div className="workbench-content">
        <main>
          {view === "inbox" && <ImportView onNavigate={navigate} />}
          {view === "library" && <LibraryView onNavigate={navigate} />}
          {view === "playlists" && <PlaylistsView onNavigate={navigate} />}
          {(view === "needs_attention" || view === "running" || view === "ready_to_dj") && <PrepareView stage={prepareStage} queueView={view} selectedTrackId={selectedTrackId} onStageChange={setPrepareStage} onSelectedTrackChange={setSelectedTrackId} pathMapFrom={settings.pathMapFrom} pathMapTo={settings.pathMapTo} />}
          {view === "discover" && <DiscoveryView onNavigate={navigate} onPlayTrack={(tracks, index) => { setPlayer({ tracks, index }); setPlayerMessage(null); }} />}
          {view === "settings" && (
            <SetupView
              settings={settings}
              onSaved={() => {
                loadSettings();
                selectView("needs_attention");
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
      </div>
      <ActivityDrawer entries={logs} open={showLogs} onClose={() => setShowLogs(false)} />
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
