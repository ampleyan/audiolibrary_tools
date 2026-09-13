use std::collections::VecDeque;
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use serde::Serialize;
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::config_store;

static LOGS: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();

#[derive(Serialize)]
pub struct LogEntry {
    timestamp: String,
    message: String,
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
