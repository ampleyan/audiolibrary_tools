use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::{config_store, db, import};

#[tauri::command]
pub fn get_settings(app: AppHandle) -> config_store::PublicSettings {
    config_store::get_public(&app)
}

#[tauri::command]
pub fn check_rekordbox(app: AppHandle, xml_path: String) -> Result<RekordboxPreview, String> {
    use std::collections::HashSet;
    let xml = std::fs::read_to_string(&xml_path)
        .map_err(|e| format!("Cannot read Rekordbox XML: {e}"))?;
    let mut tracks_in_xml = crate::rekordbox::parse_tracks(&xml);
    let library = import::list_tracks(&app, None).map_err(|e| e.to_string())?;
    let known: HashSet<(String, String)> = library
        .iter()
        .map(|t| (crate::rekordbox::normalize(&t.artist), crate::rekordbox::normalize(&t.title)))
        .collect();
    for track in &mut tracks_in_xml {
        track.in_library = known.contains(&(
            crate::rekordbox::normalize(&track.artist),
            crate::rekordbox::normalize(&track.title),
        ));
    }
    Ok(RekordboxPreview { tracks_in_xml })
}

#[tauri::command]
pub fn import_rekordbox_xml(app: AppHandle, content: String) -> Result<String, String> {
    if !content.contains("<DJ_PLAYLISTS") || !content.contains("</DJ_PLAYLISTS>") {
        return Err("Invalid Rekordbox XML: missing DJ_PLAYLISTS root".into());
    }
    let dir = db::db_path(&app)
        .parent()
        .ok_or("Cannot resolve app data directory")?
        .to_path_buf();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create app data directory: {e}"))?;
    let path = dir.join("rekordbox.xml");
    let temporary = dir.join("rekordbox.xml.tmp");
    std::fs::write(&temporary, content).map_err(|e| format!("Cannot store Rekordbox XML: {e}"))?;
    std::fs::rename(&temporary, &path).map_err(|e| format!("Cannot finalize Rekordbox XML: {e}"))?;
    let path_string = path.to_string_lossy().to_string();
    config_store::set(&app, "rekordbox_xml_path", &path_string).map_err(|e| e.to_string())?;
    Ok(path_string)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RekordboxPreview {
    pub tracks_in_xml: Vec<crate::rekordbox::RekordboxTrack>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSettingsPayload {
    pub sockseek_path: Option<String>,
    pub sockseek_daemon_url: Option<String>,
    pub prep_inbox_dir: Option<String>,
    pub beets_path: Option<String>,
    pub music_library_dir: Option<String>,
    pub beets_config_dir: Option<String>,
    pub ffmpeg_path: Option<String>,
    pub rekordbox_import_dir: Option<String>,
    pub rekordbox_xml_path: Option<String>,
    pub python_path: Option<String>,
    pub yt_cookies_file: Option<String>,
    pub sockseek_username: Option<String>,
    pub sockseek_password: Option<String>,
    pub spotify_client_id: Option<String>,
    pub spotify_client_secret: Option<String>,
    pub cosine_api_key: Option<String>,
    pub telegram_api_id: Option<String>,
    pub telegram_api_hash: Option<String>,
    pub telegram_session_path: Option<String>,
    pub setup_complete: Option<bool>,
}

#[tauri::command]
pub fn save_settings(app: AppHandle, payload: SaveSettingsPayload) -> Result<(), String> {
    let pairs: &[(&str, Option<String>)] = &[
        ("sockseek_path", payload.sockseek_path),
        ("sockseek_daemon_url", payload.sockseek_daemon_url),
        ("prep_inbox_dir", payload.prep_inbox_dir),
        ("beets_path", payload.beets_path),
        ("music_library_dir", payload.music_library_dir),
        ("beets_config_dir", payload.beets_config_dir),
        ("ffmpeg_path", payload.ffmpeg_path),
        ("rekordbox_import_dir", payload.rekordbox_import_dir),
        ("rekordbox_xml_path", payload.rekordbox_xml_path),
        ("python_path", payload.python_path),
        ("yt_cookies_file", payload.yt_cookies_file),
        ("sockseek_username", payload.sockseek_username),
        ("sockseek_password", payload.sockseek_password),
        ("spotify_client_id", payload.spotify_client_id),
        ("spotify_client_secret", payload.spotify_client_secret),
        ("cosine_api_key", payload.cosine_api_key),
        ("telegram_api_id", payload.telegram_api_id),
        ("telegram_api_hash", payload.telegram_api_hash),
        ("telegram_session_path", payload.telegram_session_path),
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
    import_youtube_url(&app, &url, None, false).await
}

async fn import_youtube_url(
    app: &AppHandle,
    url: &str,
    source_override: Option<&str>,
    skip_duplicates: bool,
) -> Result<Vec<import::TrackRow>, String> {
    let python = resolve_python(app);
    let script = resolve_yt_fetch(app);
    let cookies = config_store::get(&app, "yt_cookies_file").unwrap_or_default();

    let spotify_id = config_store::get(&app, "spotify_client_id").unwrap_or_default();
    let spotify_secret = config_store::get(&app, "spotify_client_secret").unwrap_or_default();

    let mut cmd = tokio::process::Command::new(&python);
    cmd.arg(&script).arg(url);
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
        let mut draft: import::TrackDraft = serde_json::from_str(line)
            .map_err(|e| format!("Invalid JSON from yt_fetch.py: {e}\nLine: {line}"))?;
        if let Some(source) = source_override {
            draft.source_url = Some(source.to_string());
        }
        if skip_duplicates
            && import::track_exists(app, &draft.artist, &draft.title).map_err(|e| e.to_string())?
        {
            continue;
        }
        rows.push(import::insert_track(&app, &draft).map_err(|e| e.to_string())?);
    }
    Ok(rows)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramImportResult {
    pub tracks: Vec<import::TrackRow>,
    pub skipped: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramLink {
    pub url: String,
    pub message_url: String,
}

fn telegram_session_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    if let Some(path) = config_store::get(app, "telegram_session_path").filter(|p| !p.is_empty()) {
        return Ok(std::path::PathBuf::from(path));
    }
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Cannot resolve app data directory: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create app data directory: {e}"))?;
    Ok(dir.join("telegram.session"))
}

async fn run_telegram_action(app: &AppHandle, request: Value) -> Result<Value, String> {
    let api_id = config_store::get(app, "telegram_api_id")
        .filter(|value| !value.is_empty())
        .ok_or("Set Telegram API ID in Settings first")?;
    let api_hash = config_store::get(app, "telegram_api_hash")
        .filter(|value| !value.is_empty())
        .ok_or("Set Telegram API hash in Settings first")?;
    let session_path = telegram_session_path(app)?;
    let python = resolve_python(app);
    let script = resolve_telegram_fetch(app);
    let mut child = Command::new(&python)
        .arg(&script)
        .env("TELEGRAM_API_ID", api_id)
        .env("TELEGRAM_API_HASH", api_hash)
        .env("TELEGRAM_SESSION_PATH", &session_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to launch Telegram helper ({python:?}): {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let request = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
        stdin.write_all(&request).await.map_err(|e| e.to_string())?;
        stdin.write_all(b"\n").await.map_err(|e| e.to_string())?;
    }
    let output = child.wait_with_output().await.map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("telegram_fetch.py failed: {stderr}"));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .find(|line| !line.trim().is_empty())
        .ok_or("Telegram helper returned no response")?;
    serde_json::from_str(line).map_err(|e| format!("Invalid JSON from telegram_fetch.py: {e}"))
}

#[tauri::command]
pub async fn telegram_login_start(app: AppHandle, phone: String) -> Result<String, String> {
    let result = run_telegram_action(&app, serde_json::json!({
        "action": "login_start",
        "phone": phone,
    }))
    .await?;
    result
        .get("status")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or("Telegram helper returned no login status".into())
}

#[tauri::command]
pub async fn telegram_login_code(
    app: AppHandle,
    code: String,
    password: Option<String>,
) -> Result<String, String> {
    let result = run_telegram_action(&app, serde_json::json!({
        "action": "login_code",
        "code": code,
        "password": password,
    }))
    .await?;
    result
        .get("status")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or("Telegram helper returned no login status".into())
}

#[tauri::command]
pub async fn telegram_check(app: AppHandle) -> Result<String, String> {
    let result = run_telegram_action(&app, serde_json::json!({ "action": "check" })).await?;
    result
        .get("status")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or("Telegram helper returned no session status".into())
}

#[tauri::command]
pub async fn telegram_fetch_links(
    app: AppHandle,
    channel_id: String,
    limit: Option<u32>,
) -> Result<Vec<TelegramLink>, String> {
    let result = run_telegram_action(&app, serde_json::json!({
        "action": "fetch",
        "channel_id": channel_id,
        "limit": limit.unwrap_or(100).clamp(1, 1000),
    }))
    .await?;
    let messages = result
        .get("messages")
        .and_then(Value::as_array)
        .ok_or("Telegram helper returned no messages")?;
    let mut links = Vec::new();
    for message in messages {
        let url = message.get("url").and_then(Value::as_str).unwrap_or_default();
        if url.is_empty() {
            continue;
        }
        links.push(TelegramLink {
            url: url.to_string(),
            message_url: message
                .get("message_url")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        });
    }
    Ok(links)
}

#[tauri::command]
pub async fn import_telegram_link(
    app: AppHandle,
    url: String,
    message_url: String,
    import_tag: String,
) -> Result<Vec<import::TrackRow>, String> {
    let rows = import_youtube_url(&app, &url, Some(&message_url), true).await?;
    let conn = db::open(&app).map_err(|e| e.to_string())?;
    for row in &rows {
        conn.execute(
            "UPDATE tracks SET import_tag = ?1 WHERE id = ?2",
            rusqlite::params![import_tag, row.id],
        )
        .map_err(|e| e.to_string())?;
    }
    rows.into_iter()
        .map(|row| import::get_track(&app, row.id).map_err(|e| e.to_string()))
        .collect()
}

#[tauri::command]
pub async fn import_telegram(
    app: AppHandle,
    channel_id: String,
    limit: Option<u32>,
) -> Result<TelegramImportResult, String> {
    let links = telegram_fetch_links(app.clone(), channel_id, limit).await?;
    let mut tracks = Vec::new();
    let mut skipped = Vec::new();
    for link in links {
        match import_telegram_link(app.clone(), link.url.clone(), link.message_url, "Telegram".into()).await {
            Ok(mut rows) => tracks.append(&mut rows),
            Err(error) => skipped.push(format!("{}: {error}", link.url)),
        }
    }
    Ok(TelegramImportResult { tracks, skipped })
}

#[tauri::command]
pub fn list_tracks(
    app: AppHandle,
    state: Option<String>,
) -> Result<Vec<import::TrackRow>, String> {
    import::list_tracks(&app, state.as_deref()).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEntry {
    pub id: i64,
    pub track_id: i64,
    pub artist: String,
    pub title: String,
    pub from_state: Option<String>,
    pub to_state: String,
    pub created_at: String,
}

#[tauri::command]
pub fn list_activity(app: AppHandle, limit: Option<i64>) -> Result<Vec<ActivityEntry>, String> {
    let conn = db::open(&app).map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(30).clamp(1, 100);
    let mut statement = conn.prepare(
        "SELECT a.id, a.track_id, coalesce(t.artist, ''), coalesce(t.title, ''), a.from_state, a.to_state, a.created_at
         FROM activities a LEFT JOIN tracks t ON t.id = a.track_id ORDER BY a.id DESC LIMIT ?1",
    ).map_err(|e| e.to_string())?;
    let rows = statement.query_map(rusqlite::params![limit], |row| Ok(ActivityEntry {
        id: row.get(0)?,
        track_id: row.get(1)?,
        artist: row.get(2)?,
        title: row.get(3)?,
        from_state: row.get(4)?,
        to_state: row.get(5)?,
        created_at: row.get(6)?,
    })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
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
    conn.execute("DELETE FROM activities", [])
        .map_err(|e| e.to_string())?;
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
        "UPDATE tracks SET artist = ?1, title = ?2, mix_version = ?3, state = CASE WHEN state = 'needs_review' AND ?1 <> '' AND ?2 <> '' THEN 'requested' ELSE state END, updated_at = datetime('now') WHERE id = ?4",
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
        for venv in [
            root.join("dj-prep-tool").join(".venv").join("Scripts").join("python.exe"),
            root.join(".venv").join("Scripts").join("python.exe"),
        ] {
            if venv.exists() {
                return venv;
            }
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

fn resolve_telegram_fetch(_app: &AppHandle) -> std::path::PathBuf {
    if let Some(root) = db::project_root() {
        return root.join("dj-prep-tool").join("py").join("telegram_fetch.py");
    }
    let exe = std::env::current_exe().unwrap_or_default();
    exe.parent().unwrap_or(std::path::Path::new(".")).join("py").join("telegram_fetch.py")
}
