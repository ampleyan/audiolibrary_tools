use std::collections::VecDeque;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use rusqlite::backup::Backup;
use serde::Serialize;
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::{config_store, db};

static LOGS: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();
static DAEMON_CHILD: OnceLock<tokio::sync::Mutex<Option<tokio::process::Child>>> = OnceLock::new();

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

async fn stop_managed_daemon() {
    let store = DAEMON_CHILD.get_or_init(|| tokio::sync::Mutex::new(None));
    let child = store.lock().await.take();
    if let Some(mut child) = child {
        let _ = child.kill().await;
        let _ = child.wait().await;
        log_line("[app] Sockseek daemon stopped".to_string());
    }
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
    stop_managed_daemon().await;

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
    let store = DAEMON_CHILD.get_or_init(|| tokio::sync::Mutex::new(None));
    *store.lock().await = Some(child);
    log_line("[app] Sockseek daemon launched".to_string());

    Ok(())
}

#[tauri::command]
pub async fn restart_sockseek(app: AppHandle) -> Result<(), String> {
    launch_sockseek(app).await
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
        ("Beets executable", "beets_path", false),
        ("Music library", "music_library_dir", false),
        ("Beets configuration", "beets_config_dir", false),
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
        if key == "prep_inbox_dir" && ok {
            if let Ok(bytes) = fs2::available_space(&value) {
                let free_gb = bytes / 1_073_741_824;
                checks.push(SetupCheck {
                    name: "Free storage".into(),
                    ok: bytes >= 5 * 1_073_741_824,
                    detail: format!("{free_gb} GB available"),
                });
            }
        }
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

fn backup_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(db::db_path(app)
        .parent()
        .ok_or("database path has no parent directory")?
        .join("backups"))
}

#[tauri::command]
pub fn list_backups(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = backup_dir(&app)?;
    let mut names = std::fs::read_dir(dir)
        .map_err(|e| format!("list backups failed: {e}"))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_str()?.to_string();
            (path.is_file() && name.starts_with("dj_prep-") && path.extension()?.to_str()? == "sqlite").then_some(name)
        })
        .collect::<Vec<_>>();
    names.sort_by(|a, b| b.cmp(a));
    Ok(names)
}

#[tauri::command]
pub fn restore_database(app: AppHandle, backup_name: String) -> Result<(), String> {
    let safe_name = Path::new(&backup_name)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| *name == backup_name && name.starts_with("dj_prep-") && name.ends_with(".sqlite"))
        .ok_or("invalid backup name")?;
    let source_path = backup_dir(&app)?.join(safe_name);
    if !source_path.is_file() {
        return Err("backup not found".into());
    }
    let source = rusqlite::Connection::open(&source_path).map_err(|e| format!("open backup failed: {e}"))?;
    let destination_path = db::db_path(&app);
    let mut destination = rusqlite::Connection::open(&destination_path)
        .map_err(|e| format!("open database failed: {e}"))?;
    let backup = Backup::new(&source, &mut destination)
        .map_err(|e| format!("prepare restore failed: {e}"))?;
    backup
        .run_to_completion(5, Duration::from_millis(50), None)
        .map_err(|e| format!("restore failed: {e}"))?;
    Ok(())
}
