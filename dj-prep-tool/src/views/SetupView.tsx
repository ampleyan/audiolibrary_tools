import { useEffect, useMemo, useState } from "react";
import { api, SaveSettingsPayload } from "../lib/api";
import type { PublicSettings, RekordboxPreview } from "../lib/types";

interface Props {
  settings: PublicSettings;
  onSaved: () => void;
}

const s: Record<string, React.CSSProperties> = {
  field: { display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 },
  label: { fontSize: 11, color: "#a48e9b", letterSpacing: "0.06em", textTransform: "uppercase" as const, fontWeight: 500 },
  input: { background: "#0d0a0f", border: "1px solid #513343", borderRadius: 6, color: "#f1dce6", padding: "8px 10px", fontSize: 13, fontFamily: "inherit", width: "100%", boxSizing: "border-box" as const },
  section: { marginBottom: 8 },
  sectionHead: { fontSize: 10, color: "#6f8293", marginBottom: 14, letterSpacing: "0.1em", textTransform: "uppercase" as const, fontWeight: 600 },
  hint: { fontSize: 11, color: "#6f8293", marginTop: 4 },
  infoRow: { display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderBottom: "1px solid #2d2029" },
  card: { background: "#171118", border: "1px solid #352330", borderRadius: 10, padding: "20px 20px 6px", marginBottom: 16 },
};

export default function SetupView({ settings, onSaved }: Props) {
  const [form, setForm] = useState<SaveSettingsPayload>({
    sockseekDaemonUrl: settings.sockseekDaemonUrl || "http://127.0.0.1:5030",
    rekordboxXmlPath: settings.rekordboxXmlPath,
    pathMapFrom: settings.pathMapFrom ?? "",
    pathMapTo: settings.pathMapTo ?? "",
    beetsUrl: settings.beetsUrl ?? "",
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
  const [importingXml, setImportingXml] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState("");

  useEffect(() => {
    api.checkDaemon().then(setDaemonUp).catch(() => setDaemonUp(false));
    api.listBackups().then(setBackups).catch(() => setBackups([]));
  }, []);

  const set = (key: keyof SaveSettingsPayload) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const validate = async () => {
    setChecking(true);
    setError(null);
    try { setChecks(await api.validateSetup()); }
    catch (e) { setError(String(e)); }
    finally { setChecking(false); }
  };

  const checkRekordbox = async () => {
    setError(null);
    setRekordboxPreview(null);
    try { setRekordboxPreview(await api.checkRekordbox(form.rekordboxXmlPath?.trim() ?? "")); }
    catch (e) { setError(String(e)); }
  };

  const importRekordboxXml = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportingXml(true);
    setError(null);
    setRekordboxPreview(null);
    try {
      const path = await api.importRekordboxXml(await file.text());
      setForm((current) => ({ ...current, rekordboxXmlPath: path }));
      setDirty(true);
      setRekordboxPreview(await api.checkRekordbox(path));
      onSaved();
    } catch (e) { setError(String(e)); }
    finally { setImportingXml(false); }
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
    try { setBackupMessage(`Backup created: ${await api.backupDatabase()}`); setBackups(await api.listBackups()); }
    catch (e) { setError(String(e)); }
    finally { setBackingUp(false); }
  };

  const restore = async () => {
    if (!selectedBackup || !window.confirm(`Restore ${selectedBackup}? Current data will be replaced.`)) return;
    setRestoring(true);
    setBackupMessage(null);
    setError(null);
    try { await api.restoreDatabase(selectedBackup); setBackupMessage(`Restored ${selectedBackup}. Restart the app before continuing.`); }
    catch (e) { setError(String(e)); }
    finally { setRestoring(false); }
  };

  const resetLibrary = async () => {
    if (resetConfirmation !== "RESET") return;
    setResetting(true);
    setError(null);
    try { await api.clearTracks(); setBackupMessage("Library reset. All tracks and activity history were removed."); setResetConfirmation(""); onSaved(); }
    catch (e) { setError(String(e)); }
    finally { setResetting(false); }
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
      await api.saveSettings(payload);
      setDirty(false);
      if (markComplete) onSaved();
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  };

  const Field = ({ label: lbl, k, type = "text", placeholder }: { label: string; k: keyof SaveSettingsPayload; type?: string; placeholder?: string }) => (
    <div style={s.field}>
      <span style={s.label}>{lbl}</span>
      <input style={s.input} type={type} autoComplete={type === "password" ? "new-password" : "off"} value={(form[k] as string) ?? ""} onChange={(event) => { setDirty(true); set(k)(event); }} placeholder={placeholder} />
    </div>
  );

  return (
    <div className="view setup-view" style={{ maxWidth: 600 }}>
      <div className="view-heading"><h2>Settings</h2></div>

      <nav className="settings-section-nav" aria-label="Settings sections">
        <a href="#connections">Connections</a><a href="#paths">Paths</a><a href="#integrations">Import integrations</a><a href="#tagging">Tagging</a><a href="#advanced">Advanced</a><a href="#danger-zone">Danger zone</a>
      </nav>
      {dirty && <div className="settings-save-bar" role="status"><span>Unsaved changes</span><button className="button primary" disabled={saving} onClick={() => save(false)}>{saving ? "Saving…" : "Save changes"}</button></div>}

      {/* SOULSEEK */}
      <section id="connections" style={s.card}>
        <h3 style={s.sectionHead}>SOULSEEK <span style={{ color: "#ff4fa3", fontWeight: 400 }}>(required for downloads)</span></h3>
        <div style={s.field}>
          <span style={s.label}>Daemon URL</span>
          <input style={s.input} value={form.sockseekDaemonUrl ?? ""} onChange={set("sockseekDaemonUrl")} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: daemonUp === null ? "#6f8293" : daemonUp ? "#4ade80" : "#f87171" }}>
            {daemonUp === null ? "Checking…" : daemonUp ? "● Connected" : "○ Not reachable"}
          </span>
          <button style={{ background: "transparent", color: "#6f8293", border: "none", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }} onClick={() => api.checkDaemon().then(setDaemonUp).catch(() => setDaemonUp(false))}>Re-check</button>
        </div>
        <p style={{ fontSize: 12, color: "#6f8293", marginBottom: 14 }}>
          Credentials stored locally — never returned to this screen after save.{" "}
          {settings.hasSockseekCredentials && <span style={{ color: "#4ade80" }}>✓ saved</span>}
        </p>
        <Field label="Username" k="sockseekUsername" placeholder={settings.hasSockseekCredentials ? "(leave blank to keep)" : ""} />
        <Field label="Password" k="sockseekPassword" type="password" placeholder={settings.hasSockseekCredentials ? "(leave blank to keep)" : ""} />
      </section>

      {/* REKORDBOX */}
      <section id="paths" style={s.card}>
        <h3 style={s.sectionHead}>REKORDBOX &amp; PATHS <span style={{ color: "#a48e9b", fontWeight: 400 }}>(optional)</span></h3>
        <div style={s.field}>
          <span style={s.label}>XML library</span>
          <input style={s.input} value={form.rekordboxXmlPath ?? ""} onChange={set("rekordboxXmlPath")} placeholder="Path to exported rekordbox.xml" />
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button onClick={checkRekordbox} disabled={!form.rekordboxXmlPath?.trim()} style={{ background: "transparent", color: form.rekordboxXmlPath?.trim() ? "#60a5fa" : "#513343", border: "1px solid #352330", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: form.rekordboxXmlPath?.trim() ? "pointer" : "not-allowed" }}>Preview XML</button>
            <label style={{ display: "inline-flex", alignItems: "center", background: "transparent", color: "#ff4fa3", border: "1px solid #76134b", borderRadius: 6, padding: "5px 10px", fontSize: 12, cursor: importingXml ? "wait" : "pointer" }}>
              {importingXml ? "Loading…" : "Load XML into app"}
              <input type="file" accept=".xml,text/xml,application/xml" onChange={importRekordboxXml} disabled={importingXml} style={{ display: "none" }} />
            </label>
          </div>
          {rekordboxPreview && (
            <div style={{ marginTop: 10, border: "1px solid #352330", borderRadius: 8, padding: 10 }}>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, marginBottom: 8 }}>
                <span style={{ color: "#4ade80" }}>{rekordboxPreview.tracksInXml.length} tracks</span>
                <span style={{ color: "#60a5fa" }}>{rekordboxPreview.tracksInXml.filter((t) => t.inLibrary).length} in library</span>
              </div>
              <input style={{ ...s.input, marginBottom: 8 }} value={rekordboxQuery} onChange={(e) => setRekordboxQuery(e.target.value)} placeholder="Filter…" />
              <div style={{ maxHeight: 320, overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: "#6f8293", textAlign: "left", fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      <th style={{ padding: "4px 6px 4px 0" }}>Artist</th>
                      <th style={{ padding: 4 }}>Title</th>
                      <th style={{ padding: 4 }}>Mix</th>
                      <th style={{ padding: 4, width: 20 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRekordboxTracks.map((track, i) => (
                      <tr key={`${track.artist}-${track.title}-${i}`} style={{ borderTop: "1px solid #2d2029", opacity: track.inLibrary ? 0.45 : 1 }}>
                        <td style={{ padding: "5px 6px 5px 0", color: "#d5e6ef" }}>{track.artist}</td>
                        <td style={{ padding: 5, color: "#d5e6ef" }}>{track.title}</td>
                        <td style={{ padding: 5, color: "#a48e9b" }}>{track.mixVersion ?? ""}</td>
                        <td style={{ padding: 5, color: "#4ade80", textAlign: "right" }}>{track.inLibrary ? "✓" : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div style={s.field}>
          <span style={s.label}>File path mapping</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input style={{ ...s.input, flex: 1 }} value={form.pathMapFrom ?? ""} onChange={set("pathMapFrom")} placeholder="Windows prefix e.g. C:/Users/alex/Music" />
            <span style={{ color: "#6f8293", flexShrink: 0 }}>→</span>
            <input style={{ ...s.input, flex: 1 }} value={form.pathMapTo ?? ""} onChange={set("pathMapTo")} placeholder="Local prefix e.g. /Volumes/Music" />
          </div>
          <span style={s.hint}>Maps Windows Rekordbox paths to local paths so Reveal works on Mac/Linux.</span>
        </div>
      </section>

      {/* TAGGING */}
      <section id="tagging" style={s.card}>
        <h3 style={s.sectionHead}>TAGGING</h3>
        <p style={{ fontSize: 12, color: "#6f8293", marginBottom: 14 }}>Beets runs in its own container and tags files against MusicBrainz. Config lives in <code style={{ color: "#a48e9b" }}>beets-config/config.yaml</code>.</p>
        <div style={s.field}>
          <span style={s.label}>Beets URL</span>
          <input style={s.input} value={form.beetsUrl ?? ""} onChange={set("beetsUrl")} placeholder="http://beets:8337 (default)" />
          <span style={s.hint}>Override only if running beets outside Docker.</span>
        </div>
      </section>

      {/* YOUTUBE */}
      <section id="integrations" style={s.card}>
        <h3 style={s.sectionHead}>YOUTUBE</h3>
        <div style={s.field}>
          <span style={s.label}>Cookies file <span style={{ color: "#6f8293", textTransform: "none" }}>(optional)</span></span>
          <input style={s.input} value={form.ytCookiesFile ?? ""} onChange={set("ytCookiesFile")} placeholder="/data/cookies.txt" />
          <span style={s.hint}>Required for private playlists. Export with "Get cookies.txt LOCALLY" browser extension.</span>
        </div>
      </section>

      {/* TELEGRAM */}
      <section style={s.card}>
        <h3 style={s.sectionHead}>TELEGRAM <span style={{ color: "#6f8293", fontWeight: 400 }}>(optional)</span></h3>
        <p style={{ fontSize: 12, color: "#6f8293", marginBottom: 14 }}>
          For importing YouTube links from channels. Get API credentials at my.telegram.org.{" "}
          {settings.hasTelegramCredentials && <span style={{ color: "#4ade80" }}>✓ saved</span>}
          {settings.hasTelegramSession && <span style={{ color: "#4ade80", marginLeft: 8 }}>✓ session active</span>}
        </p>
        <Field label="API ID" k="telegramApiId" placeholder={settings.hasTelegramCredentials ? "(leave blank to keep)" : "123456"} />
        <Field label="API hash" k="telegramApiHash" type="password" placeholder={settings.hasTelegramCredentials ? "(leave blank to keep)" : ""} />
        <Field label="Session path" k="telegramSessionPath" placeholder="Leave blank for app data directory" />
      </section>

      {/* SPOTIFY */}
      <section style={s.card}>
        <h3 style={s.sectionHead}>SPOTIFY <span style={{ color: "#6f8293", fontWeight: 400 }}>(optional)</span></h3>
        <p style={{ fontSize: 12, color: "#6f8293", marginBottom: 14 }}>
          For Spotify playlist import. Create an app at developer.spotify.com.{" "}
          {settings.hasSpotifyCredentials && <span style={{ color: "#4ade80" }}>✓ saved</span>}
        </p>
        <Field label="Client ID" k="spotifyClientId" placeholder={settings.hasSpotifyCredentials ? "(leave blank to keep)" : ""} />
        <Field label="Client secret" k="spotifyClientSecret" type="password" placeholder={settings.hasSpotifyCredentials ? "(leave blank to keep)" : ""} />
      </section>

      {/* COSINE */}
      <section style={s.card}>
        <h3 style={s.sectionHead}>COSINE.CLUB <span style={{ color: "#6f8293", fontWeight: 400 }}>(optional)</span></h3>
        <p style={{ fontSize: 12, color: "#6f8293", marginBottom: 14 }}>
          Per-track similarity recommendations.{" "}
          {settings.hasCosineCredentials && <span style={{ color: "#4ade80" }}>✓ saved</span>}
        </p>
        <Field label="API key" k="cosineApiKey" type="password" placeholder={settings.hasCosineCredentials ? "(leave blank to keep)" : "cosine_…"} />
      </section>

      {/* SYSTEM INFO */}
      <section id="advanced" style={s.card}>
        <h3 style={s.sectionHead}>SYSTEM</h3>
        <div style={{ borderRadius: 6, fontSize: 12 }}>
          {([["Inbox", settings.prepInboxDir], ["Library", settings.musicLibraryDir], ["Archive", settings.rekordboxImportDir], ["Python", settings.pythonPath]] as [string, string][]).map(([label, value]) => (
            <div key={label} style={s.infoRow}>
              <span style={{ color: "#a48e9b" }}>{label}</span>
              <span style={{ color: "#6f8293", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>{value || "—"}</span>
            </div>
          ))}
        </div>
        <span style={s.hint}>Read-only — set via Docker environment variables.</span>
      </section>

      {error && <p style={{ color: "#f87171", fontSize: 13, marginBottom: 16, padding: "10px 14px", background: "#1a0c0c", border: "1px solid #7f1d1d", borderRadius: 8 }}>{error}</p>}

      {checks && (
        <div style={{ marginBottom: 16, border: "1px solid #352330", borderRadius: 8, padding: "10px 14px" }}>
          {checks.map((check) => (
            <div key={check.name} style={{ display: "flex", gap: 8, justifyContent: "space-between", fontSize: 12, padding: "4px 0" }}>
              <span style={{ color: check.ok ? "#4ade80" : "#f87171" }}>{check.ok ? "✓" : "!"} {check.name}</span>
              <span style={{ color: "#6f8293" }}>{check.detail}</span>
            </div>
          ))}
        </div>
      )}

      {backupMessage && <p style={{ color: "#4ade80", fontSize: 12, marginBottom: 16 }}>{backupMessage}</p>}

      {backups.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <select value={selectedBackup} onChange={(e) => setSelectedBackup(e.target.value)} disabled={restoring} style={{ ...s.input, width: "auto", flex: 1 }}>
            <option value="">Restore a backup…</option>
            {backups.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <button onClick={restore} disabled={restoring || !selectedBackup} style={{ background: "transparent", color: selectedBackup && !restoring ? "#f87171" : "#513343", border: "1px solid #7f1d1d", borderRadius: 6, padding: "8px 12px", fontSize: 13, cursor: restoring || !selectedBackup ? "not-allowed" : "pointer" }}>
            {restoring ? "Restoring…" : "Restore"}
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
        <button style={{ background: "#76134b", color: "#ffe1ef", border: "1px solid #ff4fa3", borderRadius: 6, padding: "8px 20px", fontSize: 13, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1, fontWeight: 500 }} disabled={saving} onClick={() => save(true)}>
          {saving ? "Saving…" : "Save & continue"}
        </button>
        <button style={{ background: "transparent", color: "#a48e9b", border: "1px solid #513343", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: saving ? "not-allowed" : "pointer" }} disabled={saving} onClick={() => save(false)}>
          Save only
        </button>
        <button style={{ background: "transparent", color: "#a48e9b", border: "1px solid #513343", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: checking ? "not-allowed" : "pointer" }} disabled={checking} onClick={validate}>
          {checking ? "Checking…" : "Run integration checks"}
        </button>
        <button style={{ background: "transparent", color: "#a48e9b", border: "1px solid #513343", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: backingUp ? "not-allowed" : "pointer" }} disabled={backingUp} onClick={backup}>
          {backingUp ? "Backing up…" : "Back up DB"}
        </button>
      </div>

      <section id="danger-zone" style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid #352330" }}>
        <h3 style={{ fontSize: 10, color: "#f87171", marginBottom: 8, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>DANGER ZONE</h3>
        <p style={{ fontSize: 12, color: "#6f8293", marginBottom: 12 }}>Remove every imported track and its activity history. Downloaded files are not deleted.</p>
        <label style={{ ...s.field, maxWidth: 240 }}><span style={s.label}>Type RESET to enable</span><input style={s.input} value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} placeholder="RESET" aria-label="Type RESET to reset library" /></label>
        <button style={{ background: "transparent", color: resetting || resetConfirmation !== "RESET" ? "#513343" : "#f87171", border: "1px solid #7f1d1d", borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: resetting || resetConfirmation !== "RESET" ? "not-allowed" : "pointer" }} disabled={resetting || resetConfirmation !== "RESET"} onClick={resetLibrary}>
          {resetting ? "Resetting…" : "Reset library"}
        </button>
      </section>
    </div>
  );
}
