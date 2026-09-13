use serde::Deserialize;
use tauri::AppHandle;

use crate::{config_store, db, import};

#[tauri::command]
pub fn get_settings(app: AppHandle) -> config_store::PublicSettings {
    config_store::get_public(&app)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSettingsPayload {
    pub sockseek_path: Option<String>,
    pub sockseek_daemon_url: Option<String>,
    pub prep_inbox_dir: Option<String>,
    pub picard_path: Option<String>,
    pub ffmpeg_path: Option<String>,
    pub rekordbox_import_dir: Option<String>,
    pub python_path: Option<String>,
    pub yt_cookies_file: Option<String>,
    pub sockseek_username: Option<String>,
    pub sockseek_password: Option<String>,
    pub spotify_client_id: Option<String>,
    pub spotify_client_secret: Option<String>,
    pub cosine_api_key: Option<String>,
    pub setup_complete: Option<bool>,
}

#[tauri::command]
pub fn save_settings(app: AppHandle, payload: SaveSettingsPayload) -> Result<(), String> {
    let pairs: &[(&str, Option<String>)] = &[
        ("sockseek_path", payload.sockseek_path),
        ("sockseek_daemon_url", payload.sockseek_daemon_url),
        ("prep_inbox_dir", payload.prep_inbox_dir),
        ("picard_path", payload.picard_path),
        ("ffmpeg_path", payload.ffmpeg_path),
        ("rekordbox_import_dir", payload.rekordbox_import_dir),
        ("python_path", payload.python_path),
        ("yt_cookies_file", payload.yt_cookies_file),
        ("sockseek_username", payload.sockseek_username),
        ("sockseek_password", payload.sockseek_password),
        ("spotify_client_id", payload.spotify_client_id),
        ("spotify_client_secret", payload.spotify_client_secret),
        ("cosine_api_key", payload.cosine_api_key),
    ];
    for (key, val) in pairs {
        if let Some(v) = val {
            config_store::set(&app, key, v).map_err(|e| e.to_string())?;
        }
    }
    if let Some(complete) = payload.setup_complete {
        config_store::set(&app, "setup_complete", if complete { "true" } else { "false" })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn import_text(app: AppHandle, text: String) -> Result<Vec<import::TrackRow>, String> {
    import::parse_text(&text)
        .iter()
        .map(|d| import::insert_track(&app, d).map_err(|e| e.to_string()))
        .collect()
}

#[tauri::command]
pub fn import_csv(app: AppHandle, content: String) -> Result<Vec<import::TrackRow>, String> {
    import::parse_csv(&content)
        .iter()
        .map(|d| import::insert_track(&app, d).map_err(|e| e.to_string()))
        .collect()
}

#[tauri::command]
pub async fn import_youtube(app: AppHandle, url: String) -> Result<Vec<import::TrackRow>, String> {
    let python = resolve_python(&app);
    let script = resolve_yt_fetch(&app);
    let cookies = config_store::get(&app, "yt_cookies_file").unwrap_or_default();

    let spotify_id = config_store::get(&app, "spotify_client_id").unwrap_or_default();
    let spotify_secret = config_store::get(&app, "spotify_client_secret").unwrap_or_default();

    let mut cmd = tokio::process::Command::new(&python);
    cmd.arg(&script).arg(&url);
    if !cookies.is_empty() {
        cmd.arg(&cookies);
    }
    if !spotify_id.is_empty() {
        cmd.env("SPOTIFY_CLIENT_ID", &spotify_id);
    }
    if !spotify_secret.is_empty() {
        cmd.env("SPOTIFY_CLIENT_SECRET", &spotify_secret);
    }
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to launch Python ({python:?}): {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt_fetch.py failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut rows = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let draft: import::TrackDraft = serde_json::from_str(line)
            .map_err(|e| format!("Invalid JSON from yt_fetch.py: {e}\nLine: {line}"))?;
        rows.push(import::insert_track(&app, &draft).map_err(|e| e.to_string())?);
    }
    Ok(rows)
}

#[tauri::command]
pub fn list_tracks(
    app: AppHandle,
    state: Option<String>,
) -> Result<Vec<import::TrackRow>, String> {
    import::list_tracks(&app, state.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_track_state(app: AppHandle, id: i64, state: String) -> Result<(), String> {
    import::update_track_state(&app, id, &state).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_track(app: AppHandle, id: i64) -> Result<(), String> {
    let conn = db::open(&app).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tracks WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn clear_tracks(app: AppHandle) -> Result<(), String> {
    let conn = db::open(&app).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM tracks", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_track(
    app: AppHandle,
    id: i64,
    artist: String,
    title: String,
    mix_version: Option<String>,
) -> Result<import::TrackRow, String> {
    use rusqlite::params;
    let conn = db::open(&app).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE tracks SET artist = ?1, title = ?2, mix_version = ?3, updated_at = datetime('now') WHERE id = ?4",
        params![artist, title, mix_version, id],
    )
    .map_err(|e| e.to_string())?;
    import::get_track(&app, id).map_err(|e| e.to_string())
}

// ── Path resolution ────────────────────────────────────────────────────────

fn resolve_python(app: &AppHandle) -> std::path::PathBuf {
    if let Some(p) = config_store::get(app, "python_path") {
        let path = std::path::PathBuf::from(&p);
        if path.exists() {
            return path;
        }
    }
    if let Some(root) = db::project_root() {
        let venv = root.join(".venv").join("Scripts").join("python.exe");
        if venv.exists() {
            return venv;
        }
    }
    std::path::PathBuf::from("python")
}

fn resolve_yt_fetch(_app: &AppHandle) -> std::path::PathBuf {
    if let Some(root) = db::project_root() {
        return root.join("dj-prep-tool").join("py").join("yt_fetch.py");
    }
    let exe = std::env::current_exe().unwrap_or_default();
    exe.parent().unwrap_or(std::path::Path::new(".")).join("py").join("yt_fetch.py")
}
