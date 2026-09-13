import { useEffect, useState } from "react";
import { api, SaveSettingsPayload } from "../lib/api";
import type { PublicSettings } from "../lib/types";

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
    picardPath: settings.picardPath,
    ffmpegPath: settings.ffmpegPath,
    rekordboxImportDir: settings.rekordboxImportDir,
    pythonPath: settings.pythonPath,
    ytCookiesFile: settings.ytCookiesFile,
    sockseekUsername: "",
    sockseekPassword: "",
    spotifyClientId: "",
    spotifyClientSecret: "",
    cosineApiKey: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [daemonUp, setDaemonUp] = useState<boolean | null>(null);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    api.checkDaemon().then(setDaemonUp).catch(() => setDaemonUp(false));
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
      await api.saveSettings(payload);
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
        <PathField label="Rekordbox import folder" k="rekordboxImportDir" />
        <PathField label="Picard executable" k="picardPath" />
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

      <div style={{ display: "flex", gap: 10 }}>
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
    </div>
  );
}
