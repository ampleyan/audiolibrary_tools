use std::collections::VecDeque;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use serde::Serialize;
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::{config_store, db};

static LOGS: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();

#[derive(Serialize)]
pub struct LogEntry {
    timestamp: String,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupCheck {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

fn log_line(message: String) {
    let logs = LOGS.get_or_init(|| Mutex::new(VecDeque::new()));
    if let Ok(mut logs) = logs.lock() {
        if logs.len() >= 300 { logs.pop_front(); }
        logs.push_back(message);
    }
}

fn capture<R>(reader: R)
where R: tokio::io::AsyncRead + Unpin + Send + 'static {
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.to_lowercase().contains("password") || line.to_lowercase().contains("--pass") {
                log_line("[redacted sensitive log line]".to_string());
            } else {
                log_line(line);
            }
        }
    });
}

#[tauri::command]
pub async fn launch_sockseek(app: AppHandle) -> Result<(), String> {
    let path = config_store::get(&app, "sockseek_path")
        .filter(|s| !s.is_empty())
        .ok_or("sockseek_path not configured — set it in Setup")?;
    let username = config_store::get(&app, "sockseek_username")
        .filter(|s| !s.is_empty())
        .ok_or("Soulseek username not configured — set it in Setup")?;
    let password = config_store::get(&app, "sockseek_password")
        .filter(|s| !s.is_empty())
        .ok_or("Soulseek password not configured — set it in Setup")?;
    let prep_inbox = config_store::get(&app, "prep_inbox_dir").unwrap_or_default();

    let mut child = tokio::process::Command::new(&path)
        .args([
            "daemon",
            "--no-config",
            "--user",
            &username,
            "--pass",
            &password,
            "-o",
            &prep_inbox,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to launch sockseek: {e}"))?;

    if let Some(stdout) = child.stdout.take() { capture(stdout); }
    if let Some(stderr) = child.stderr.take() { capture(stderr); }
    log_line("[app] Sockseek daemon launched".to_string());

    Ok(())
}

#[tauri::command]
pub fn get_logs() -> Vec<LogEntry> {
    LOGS.get_or_init(|| Mutex::new(VecDeque::new())).lock().map(|logs| logs.iter().cloned().map(|message| LogEntry { timestamp: String::new(), message }).collect()).unwrap_or_default()
}

#[tauri::command]
pub async fn check_daemon(app: AppHandle) -> bool {
    let url = config_store::get(&app, "sockseek_daemon_url")
        .unwrap_or_else(|| "http://127.0.0.1:5030".to_string());
    reqwest::get(&url).await.is_ok()
}

#[tauri::command]
pub async fn validate_setup(app: AppHandle) -> Vec<SetupCheck> {
    let mut checks = Vec::new();
    let daemon_url = config_store::get(&app, "sockseek_daemon_url")
        .unwrap_or_else(|| "http://127.0.0.1:5030".to_string());
    checks.push(SetupCheck {
        name: "Sockseek daemon".into(),
        ok: reqwest::get(&daemon_url).await.is_ok(),
        detail: daemon_url,
    });

    for (name, key, required) in [
        ("Sockseek credentials", "sockseek_username", true),
        ("Prep inbox", "prep_inbox_dir", true),
        ("Rekordbox folder", "rekordbox_import_dir", false),
        ("Picard executable", "picard_path", false),
        ("ffmpeg executable", "ffmpeg_path", false),
    ] {
        let value = config_store::get(&app, key).unwrap_or_default();
        let present = !value.trim().is_empty();
        let ok = if key == "sockseek_username" {
            present && config_store::get(&app, "sockseek_password").is_some()
        } else if present {
            Path::new(&value).exists()
        } else {
            !required
        };
        let detail = if key == "sockseek_username" {
            if ok { "credentials saved" } else { "username and password required" }.into()
        } else if present {
            if ok { "path exists" } else { "path not found" }.into()
        } else if required {
            "required".into()
        } else {
            "optional".into()
        };
        checks.push(SetupCheck { name: name.into(), ok, detail });
    }
    checks
}

#[tauri::command]
pub fn backup_database(app: AppHandle) -> Result<String, String> {
    let source = db::db_path(&app);
    let backup_dir = source
        .parent()
        .ok_or("database path has no parent directory")?
        .join("backups");
    std::fs::create_dir_all(&backup_dir).map_err(|e| format!("create backup folder failed: {e}"))?;
    db::open(&app)
        .map_err(|e| format!("open database failed: {e}"))?
        .execute_batch("PRAGMA wal_checkpoint(FULL);")
        .map_err(|e| format!("checkpoint database failed: {e}"))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("clock error: {e}"))?
        .as_secs();
    let destination = backup_dir.join(format!("dj_prep-{timestamp}.sqlite"));
    std::fs::copy(&source, &destination).map_err(|e| format!("backup failed: {e}"))?;
    Ok(destination.to_string_lossy().to_string())
}
