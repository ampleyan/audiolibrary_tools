import { useEffect, useMemo, useState } from "react";
import { api, SaveSettingsPayload } from "../lib/api";
import type { PublicSettings, RekordboxPreview } from "../lib/types";

interface Props {
  settings: PublicSettings;
  onSaved: () => void;
}

const field: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  marginBottom: 14,
};

const label: React.CSSProperties = {
  fontSize: 12,
  color: "#9ca3af",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

const input: React.CSSProperties = {
  background: "#111827",
  border: "1px solid #374151",
  borderRadius: 4,
  color: "#f9fafb",
  padding: "6px 10px",
  fontSize: 13,
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
};

export default function SetupView({ settings, onSaved }: Props) {
  const [form, setForm] = useState<SaveSettingsPayload>({
    sockseekPath: settings.sockseekPath,
    sockseekDaemonUrl: settings.sockseekDaemonUrl || "http://127.0.0.1:5030",
    prepInboxDir: settings.prepInboxDir,
    beetsPath: settings.beetsPath,
    musicLibraryDir: settings.musicLibraryDir,
    beetsConfigDir: settings.beetsConfigDir,
    ffmpegPath: settings.ffmpegPath,
    rekordboxImportDir: settings.rekordboxImportDir,
    rekordboxXmlPath: settings.rekordboxXmlPath,
    pythonPath: settings.pythonPath,
    ytCookiesFile: settings.ytCookiesFile,
    sockseekUsername: "",
    sockseekPassword: "",
    spotifyClientId: "",
    spotifyClientSecret: "",
    cosineApiKey: "",
    telegramApiId: "",
    telegramApiHash: "",
    telegramSessionPath: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [daemonUp, setDaemonUp] = useState<boolean | null>(null);
  const [launching, setLaunching] = useState(false);
  const [checks, setChecks] = useState<{ name: string; ok: boolean; detail: string }[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backups, setBackups] = useState<string[]>([]);
  const [selectedBackup, setSelectedBackup] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [rekordboxPreview, setRekordboxPreview] = useState<RekordboxPreview | null>(null);
  const [rekordboxQuery, setRekordboxQuery] = useState("");

  useEffect(() => {
    api.checkDaemon().then(setDaemonUp).catch(() => setDaemonUp(false));
    api.listBackups().then(setBackups).catch(() => setBackups([]));
  }, []);

  const launchDaemon = async () => {
    setLaunching(true);
    setError(null);
    try {
      await api.launchSockseek();
      await new Promise((r) => setTimeout(r, 2000));
      const up = await api.checkDaemon().catch(() => false);
      setDaemonUp(up);
    } catch (e) {
      setError(String(e));
    } finally {
      setLaunching(false);
    }
  };

  const set = (key: keyof SaveSettingsPayload) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const validate = async () => {
    setChecking(true);
    setError(null);
    try {
      setChecks(await api.validateSetup());
    } catch (e) {
      setError(String(e));
    } finally {
      setChecking(false);
    }
  };

  const checkRekordbox = async () => {
    setError(null);
    setRekordboxPreview(null);
    try {
      setRekordboxPreview(await api.checkRekordbox(form.rekordboxXmlPath?.trim() ?? ""));
    } catch (e) {
      setError(String(e));
    }
  };

  const filteredRekordboxTracks = useMemo(() => {
    if (!rekordboxPreview) return [];
    const query = rekordboxQuery.trim().toLowerCase();
    return rekordboxPreview.tracksInXml
      .filter((track) => !query || `${track.artist} ${track.title} ${track.mixVersion ?? ""}`.toLowerCase().includes(query))
      .slice(0, 250);
  }, [rekordboxPreview, rekordboxQuery]);

  const backup = async () => {
    setBackingUp(true);
    setBackupMessage(null);
    setError(null);
    try {
      setBackupMessage(`Backup created: ${await api.backupDatabase()}`);
      setBackups(await api.listBackups());
    } catch (e) {
      setError(String(e));
    } finally {
      setBackingUp(false);
    }
  };

  const restore = async () => {
    if (!selectedBackup || !window.confirm(`Restore ${selectedBackup}? Current data will be replaced.`)) return;
    setRestoring(true);
    setBackupMessage(null);
    setError(null);
    try {
      await api.restoreDatabase(selectedBackup);
      setBackupMessage(`Restored ${selectedBackup}. Restart the app before continuing.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setRestoring(false);
    }
  };

  const resetLibrary = async () => {
    if (!window.confirm("Reset the entire library? This deletes every track and activity entry and cannot be undone.")) return;
    setResetting(true);
    setError(null);
    try {
      await api.clearTracks();
      setBackupMessage("Library reset. All tracks and activity history were removed.");
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setResetting(false);
    }
  };

  const save = async (markComplete: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const payload: SaveSettingsPayload = { ...form };
      if (markComplete) payload.setupComplete = true;
      if (!payload.sockseekUsername) delete payload.sockseekUsername;
      if (!payload.sockseekPassword) delete payload.sockseekPassword;
      if (!payload.spotifyClientId) delete payload.spotifyClientId;
      if (!payload.spotifyClientSecret) delete payload.spotifyClientSecret;
      if (!payload.cosineApiKey) delete payload.cosineApiKey;
      if (!payload.telegramApiId) delete payload.telegramApiId;
      if (!payload.telegramApiHash) delete payload.telegramApiHash;
      if (!payload.telegramSessionPath) delete payload.telegramSessionPath;
      const credentialsChanged = !!payload.sockseekUsername || !!payload.sockseekPassword;
      await api.saveSettings(payload);
      if (credentialsChanged && daemonUp && form.sockseekPath) {
        await api.restartSockseek();
        await new Promise((resolve) => setTimeout(resolve, 1500));
        setDaemonUp(await api.checkDaemon());
      }
      if (markComplete) onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const PathField = ({
    label: lbl,
    k,
  }: {
    label: string;
    k: keyof SaveSettingsPayload;
  }) => (
    <div style={field}>
      <span style={label}>{lbl}</span>
      <input
        style={input}
        value={(form[k] as string) ?? ""}
        onChange={set(k)}
        placeholder="Paste full path…"
      />
    </div>
  );

  return (
    <div
      style={{
        maxWidth: 560,
        margin: "0 auto",
        padding: "32px 24px",
        color: "#f9fafb",
      }}
    >
      <h2
        style={{ fontSize: 20, fontWeight: 600, marginBottom: 24, color: "#e5e7eb" }}
      >
        Setup
      </h2>

      <section style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>
          PATHS
        </h3>
        <PathField label="Sockseek.exe" k="sockseekPath" />
        <PathField label="Prep inbox folder" k="prepInboxDir" />
        <PathField label="Beets executable" k="beetsPath" />
        <PathField label="Music library folder" k="musicLibraryDir" />
        <PathField label="Beets configuration folder" k="beetsConfigDir" />
        <PathField label="Rekordbox import folder" k="rekordboxImportDir" />
        <div style={field}>
          <span style={label}>Rekordbox XML library (optional)</span>
          <input
            style={input}
            value={form.rekordboxXmlPath ?? ""}
            onChange={set("rekordboxXmlPath")}
            placeholder="Path to exported rekordbox.xml"
          />
          <button
            onClick={checkRekordbox}
            disabled={!form.rekordboxXmlPath?.trim()}
            style={{ alignSelf: "flex-start", marginTop: 6, background: "transparent", color: form.rekordboxXmlPath?.trim() ? "#60a5fa" : "#4b5563", border: "1px solid #374151", borderRadius: 4, padding: "5px 10px", fontSize: 12, cursor: form.rekordboxXmlPath?.trim() ? "pointer" : "not-allowed" }}
          >
            Preview XML
          </button>
          {rekordboxPreview && (
            <div style={{ marginTop: 10, border: "1px solid #293548", borderRadius: 5, padding: 10 }}>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, marginBottom: 8 }}>
                <span style={{ color: "#34d399" }}>{rekordboxPreview.tracksInXml.length} tracks parsed from XML</span>
                <span style={{ color: "#93c5fd" }}>{rekordboxPreview.matchingTrackIds.length} already in library</span>
              </div>
              <input
                style={{ ...input, marginBottom: 8 }}
                value={rekordboxQuery}
                onChange={(event) => setRekordboxQuery(event.target.value)}
                placeholder="Filter parsed tracks…"
                aria-label="Filter parsed Rekordbox tracks"
              />
              <div style={{ maxHeight: 360, overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: "#6b7280", textAlign: "left" }}>
                      <th style={{ padding: "4px 6px 4px 0" }}>Artist</th>
                      <th style={{ padding: 4 }}>Title</th>
                      <th style={{ padding: 4 }}>Mix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRekordboxTracks.map((track, index) => (
                      <tr key={`${track.artist}-${track.title}-${index}`} style={{ borderTop: "1px solid #1f2937" }}>
                        <td style={{ padding: "5px 6px 5px 0", color: "#e5e7eb" }}>{track.artist}</td>
                        <td style={{ padding: 5, color: "#e5e7eb" }}>{track.title}</td>
                        <td style={{ padding: 5, color: "#9ca3af" }}>{track.mixVersion ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredRekordboxTracks.length < rekordboxPreview.tracksInXml.filter((track) => {
                const query = rekordboxQuery.trim().toLowerCase();
                return !query || `${track.artist} ${track.title} ${track.mixVersion ?? ""}`.toLowerCase().includes(query);
              }).length && <span style={{ display: "block", color: "#6b7280", fontSize: 11, marginTop: 8 }}>Showing the first 250 matching tracks.</span>}
            </div>
          )}
          <span style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>Export XML from Rekordbox, then paste its path here. The file is only read.</span>
        </div>
        <PathField label="ffmpeg executable" k="ffmpegPath" />
        <PathField label="Python executable (leave blank for .venv)" k="pythonPath" />
        <div style={field}>
          <span style={label}>YouTube cookies file (optional)</span>
          <input
            style={input}
            value={form.ytCookiesFile ?? ""}
            onChange={set("ytCookiesFile")}
            placeholder="Path to cookies.txt exported from browser"
          />
          <span style={{ fontSize: 11, color: "#4b5563", marginTop: 2 }}>
            Required for private playlists. Export using browser extension
            "Get cookies.txt LOCALLY", save for youtube.com only.
          </span>
        </div>

        <div style={field}>
          <span style={label}>Sockseek daemon URL</span>
          <input
            style={input}
            value={form.sockseekDaemonUrl ?? ""}
            onChange={set("sockseekDaemonUrl")}
          />
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>
          TELEGRAM (optional)
        </h3>
        <p style={{ fontSize: 12, color: "#4b5563", marginBottom: 16 }}>
          Used to import YouTube links from channels your Telegram account can access. Create API credentials at{" "}
          <span style={{ color: "#6b7280" }}>my.telegram.org</span>.{" "}
          {settings.hasTelegramCredentials && <span style={{ color: "#34d399" }}>✓ API credentials saved</span>}
        </p>
        <div style={field}>
          <span style={label}>API ID</span>
          <input style={input} value={form.telegramApiId ?? ""} onChange={set("telegramApiId")} placeholder={settings.hasTelegramCredentials ? "(leave blank to keep existing)" : "123456"} />
        </div>
        <div style={field}>
          <span style={label}>API hash</span>
          <input style={input} type="password" autoComplete="new-password" value={form.telegramApiHash ?? ""} onChange={set("telegramApiHash")} placeholder={settings.hasTelegramCredentials ? "(leave blank to keep existing)" : "api hash"} />
        </div>
        <div style={field}>
          <span style={label}>Session path (optional)</span>
          <input style={input} value={form.telegramSessionPath ?? ""} onChange={set("telegramSessionPath")} placeholder="Leave blank for app data directory" />
        </div>
        {settings.hasTelegramSession && <span style={{ fontSize: 11, color: "#34d399" }}>✓ Telegram session saved locally</span>}
      </section>

      <section style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>
          SOULSEEK CREDENTIALS
        </h3>
        <p style={{ fontSize: 12, color: "#4b5563", marginBottom: 16 }}>
          Stored locally only — never returned to this screen after save.{" "}
          {settings.hasSockseekCredentials && (
            <span style={{ color: "#34d399" }}>✓ credentials saved</span>
          )}
        </p>
        <div style={field}>
          <span style={label}>Username</span>
          <input
            style={input}
            type="text"
            autoComplete="off"
            value={form.sockseekUsername ?? ""}
            onChange={set("sockseekUsername")}
            placeholder={settings.hasSockseekCredentials ? "(leave blank to keep existing)" : ""}
          />
        </div>
        <div style={field}>
          <span style={label}>Password</span>
          <input
            style={input}
            type="password"
            autoComplete="new-password"
            value={form.sockseekPassword ?? ""}
            onChange={set("sockseekPassword")}
            placeholder={settings.hasSockseekCredentials ? "(leave blank to keep existing)" : ""}
          />
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>
          SPOTIFY (optional)
        </h3>
        <p style={{ fontSize: 12, color: "#4b5563", marginBottom: 16 }}>
          Required for Spotify playlist import. Create a free app at{" "}
          <span style={{ color: "#6b7280" }}>developer.spotify.com</span> → Dashboard → Create app.{" "}
          {settings.hasSpotifyCredentials && (
            <span style={{ color: "#34d399" }}>✓ credentials saved</span>
          )}
        </p>
        <div style={field}>
          <span style={label}>Client ID</span>
          <input
            style={input}
            type="text"
            autoComplete="off"
            value={form.spotifyClientId ?? ""}
            onChange={set("spotifyClientId")}
            placeholder={settings.hasSpotifyCredentials ? "(leave blank to keep existing)" : ""}
          />
        </div>
        <div style={field}>
          <span style={label}>Client Secret</span>
          <input
            style={input}
            type="password"
            autoComplete="new-password"
            value={form.spotifyClientSecret ?? ""}
            onChange={set("spotifyClientSecret")}
            placeholder={settings.hasSpotifyCredentials ? "(leave blank to keep existing)" : ""}
          />
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>
          COSINE.CLUB (optional)
        </h3>
        <p style={{ fontSize: 12, color: "#4b5563", marginBottom: 16 }}>
          Enables per-track similarity recommendations. Get an API key at{" "}
          <span style={{ color: "#6b7280" }}>cosine.club</span>.{" "}
          {settings.hasCosineCredentials && (
            <span style={{ color: "#34d399" }}>✓ key saved</span>
          )}
        </p>
        <div style={field}>
          <span style={label}>API Key</span>
          <input
            style={input}
            type="password"
            autoComplete="new-password"
            value={form.cosineApiKey ?? ""}
            onChange={set("cosineApiKey")}
            placeholder={settings.hasCosineCredentials ? "(leave blank to keep existing)" : "cosine_…"}
          />
        </div>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>
          SOCKSEEK DAEMON
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span
            style={{
              fontSize: 12,
              color:
                daemonUp === null ? "#4b5563" : daemonUp ? "#4ade80" : "#f87171",
            }}
          >
            {daemonUp === null
              ? "Checking…"
              : daemonUp
              ? "● Running"
              : "○ Not running"}
          </span>
          <button
            style={{
              background: launching ? "#111827" : "#1e3a5f",
              color: launching ? "#4b5563" : "#60a5fa",
              border: "1px solid #1e40af",
              borderRadius: 4,
              padding: "5px 14px",
              fontSize: 12,
              cursor: launching || daemonUp === true ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              opacity: daemonUp === true ? 0.5 : 1,
            }}
            disabled={launching || daemonUp === true}
            onClick={launchDaemon}
          >
            {launching ? "Launching…" : "Launch daemon"}
          </button>
          <button
            style={{
              background: "transparent",
              color: "#4b5563",
              border: "none",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
            onClick={() =>
              api.checkDaemon().then(setDaemonUp).catch(() => setDaemonUp(false))
            }
          >
            Re-check
          </button>
        </div>
        <p style={{ fontSize: 11, color: "#374151", marginTop: 8 }}>
          Launches sockseek.exe with <code style={{ color: "#4b5563" }}>--no-config</code> using
          the credentials saved above. Runs in the background until you close it.
        </p>
      </section>

      {error && (
        <p style={{ color: "#f87171", fontSize: 13, marginBottom: 16 }}>{error}</p>
      )}

      {checks && (
        <div style={{ marginBottom: 16, border: "1px solid #293548", borderRadius: 5, padding: "8px 10px" }}>
          {checks.map((check) => (
            <div key={check.name} style={{ display: "flex", gap: 8, justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
              <span style={{ color: check.ok ? "#4ade80" : "#f87171" }}>{check.ok ? "✓" : "!"} {check.name}</span>
              <span style={{ color: "#6b7280" }}>{check.detail}</span>
            </div>
          ))}
        </div>
      )}

      {backupMessage && <p style={{ color: "#4ade80", fontSize: 12, marginBottom: 16 }}>{backupMessage}</p>}

      {backups.length > 0 && <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <select value={selectedBackup} onChange={(event) => setSelectedBackup(event.target.value)} disabled={restoring} style={{ ...input, width: "auto", flex: 1 }}>
          <option value="">Choose a backup to restore…</option>
          {backups.map((backupName) => <option key={backupName} value={backupName}>{backupName}</option>)}
        </select>
        <button onClick={restore} disabled={restoring || !selectedBackup} style={{ background: "transparent", color: selectedBackup && !restoring ? "#f87171" : "#4b5563", border: "1px solid #7f1d1d", borderRadius: 5, padding: "8px 12px", fontSize: 13, cursor: restoring || !selectedBackup ? "not-allowed" : "pointer" }}>{restoring ? "Restoring…" : "Restore"}</button>
      </div>}

      <div style={{ display: "flex", gap: 10 }}>
        <button
          style={{ background: "transparent", color: "#9ca3af", border: "1px solid #374151", borderRadius: 5, padding: "8px 16px", fontSize: 14, cursor: checking ? "not-allowed" : "pointer" }}
          disabled={checking}
          onClick={validate}
        >
          {checking ? "Checking…" : "Validate setup"}
        </button>
        <button
          style={{ background: "transparent", color: "#9ca3af", border: "1px solid #374151", borderRadius: 5, padding: "8px 16px", fontSize: 14, cursor: backingUp ? "not-allowed" : "pointer" }}
          disabled={backingUp}
          onClick={backup}
        >
          {backingUp ? "Backing up…" : "Back up database"}
        </button>
        <button
          style={{
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 5,
            padding: "8px 20px",
            fontSize: 14,
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
          disabled={saving}
          onClick={() => save(true)}
        >
          {saving ? "Saving…" : "Save & continue"}
        </button>
        <button
          style={{
            background: "transparent",
            color: "#6b7280",
            border: "1px solid #374151",
            borderRadius: 5,
            padding: "8px 16px",
            fontSize: 14,
            cursor: saving ? "not-allowed" : "pointer",
          }}
          disabled={saving}
          onClick={() => save(false)}
        >
          Save only
        </button>
      </div>

      <section style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid #293548" }}>
        <h3 style={{ fontSize: 13, color: "#f87171", marginBottom: 8 }}>DANGER ZONE</h3>
        <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
          Remove every imported track and its activity history. Downloaded files are not deleted.
        </p>
        <button
          style={{ background: "transparent", color: resetting ? "#4b5563" : "#f87171", border: "1px solid #7f1d1d", borderRadius: 5, padding: "8px 16px", fontSize: 13, cursor: resetting ? "not-allowed" : "pointer" }}
          disabled={resetting}
          onClick={resetLibrary}
        >
          {resetting ? "Resetting…" : "Reset library"}
        </button>
      </section>
    </div>
  );
}
