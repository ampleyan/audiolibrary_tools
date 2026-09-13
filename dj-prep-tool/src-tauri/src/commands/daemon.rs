use tauri::AppHandle;

use crate::config_store;

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

    tokio::process::Command::new(&path)
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
        .spawn()
        .map_err(|e| format!("Failed to launch sockseek: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn check_daemon(app: AppHandle) -> bool {
    let url = config_store::get(&app, "sockseek_daemon_url")
        .unwrap_or_else(|| "http://127.0.0.1:5030".to_string());
    reqwest::get(&url).await.is_ok()
}
