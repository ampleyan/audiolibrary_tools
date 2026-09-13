use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::db;

/// All settings returned to the frontend — credentials are never included.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSettings {
    pub sockseek_path: String,
    pub sockseek_daemon_url: String,
    pub prep_inbox_dir: String,
    pub picard_path: String,
    pub ffmpeg_path: String,
    pub rekordbox_import_dir: String,
    pub python_path: String,
    pub yt_cookies_file: String,
    pub setup_complete: bool,
    pub has_sockseek_credentials: bool,
    pub has_spotify_credentials: bool,
    pub has_cosine_credentials: bool,
}

pub fn get(app: &AppHandle, key: &str) -> Option<String> {
    let conn = db::open(app).ok()?;
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |r| r.get(0),
    )
    .ok()
}

pub fn set(app: &AppHandle, key: &str, value: &str) -> Result<(), rusqlite::Error> {
    let conn = db::open(app)?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(())
}

pub fn get_public(app: &AppHandle) -> PublicSettings {
    PublicSettings {
        sockseek_path: get(app, "sockseek_path").unwrap_or_default(),
        sockseek_daemon_url: get(app, "sockseek_daemon_url")
            .unwrap_or_else(|| "http://127.0.0.1:5030".into()),
        prep_inbox_dir: get(app, "prep_inbox_dir").unwrap_or_default(),
        picard_path: get(app, "picard_path").unwrap_or_default(),
        ffmpeg_path: get(app, "ffmpeg_path").unwrap_or_default(),
        rekordbox_import_dir: get(app, "rekordbox_import_dir").unwrap_or_default(),
        python_path: get(app, "python_path").unwrap_or_default(),
        yt_cookies_file: get(app, "yt_cookies_file").unwrap_or_default(),
        setup_complete: get(app, "setup_complete").as_deref() == Some("true"),
        has_sockseek_credentials: get(app, "sockseek_username").is_some()
            && get(app, "sockseek_password").is_some(),
        has_spotify_credentials: get(app, "spotify_client_id").is_some()
            && get(app, "spotify_client_secret").is_some(),
        has_cosine_credentials: get(app, "cosine_api_key").is_some(),
    }
}
