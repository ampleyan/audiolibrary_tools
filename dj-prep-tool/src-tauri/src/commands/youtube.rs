use serde::Serialize;
use std::io::{Read, Write};
use std::net::TcpListener;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

use crate::config_store;

const REDIRECT_URI: &str = "http://127.0.0.1:43827/oauth2callback";
const SCOPE: &str = "https://www.googleapis.com/auth/youtube";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUrl {
    pub authorized: bool,
    pub url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistResult {
    pub playlist_url: String,
    pub added: usize,
    pub skipped: Vec<String>,
}

fn credentials() -> Result<(String, String), String> {
    let id = std::env::var("YOUTUBE_CLIENT_ID").unwrap_or_default();
    let secret = std::env::var("YOUTUBE_CLIENT_SECRET").unwrap_or_default();
    if id.is_empty() || secret.is_empty() {
        return Err("Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET before using YouTube playlists".into());
    }
    Ok((id, secret))
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn token(app: &AppHandle) -> Option<String> {
    let value = config_store::get(app, "youtube_access_token")?;
    let expiry = config_store::get(app, "youtube_token_expires_at")?.parse::<i64>().ok()?;
    (expiry > now() + 60).then_some(value)
}

fn save_token(app: &AppHandle, value: &serde_json::Value) -> Result<(), String> {
    config_store::set(app, "youtube_access_token", value["access_token"].as_str().unwrap_or_default()).map_err(|e| e.to_string())?;
    if let Some(refresh) = value["refresh_token"].as_str() {
        config_store::set(app, "youtube_refresh_token", refresh).map_err(|e| e.to_string())?;
    }
    config_store::set(app, "youtube_token_expires_at", &(now() + value["expires_in"].as_i64().unwrap_or(3600)).to_string()).map_err(|e| e.to_string())
}

async fn usable_token(app: &AppHandle) -> Result<Option<String>, String> {
    if let Some(value) = token(app) { return Ok(Some(value)); }
    let refresh = match config_store::get(app, "youtube_refresh_token") { Some(value) if !value.is_empty() => value, _ => return Ok(None) };
    let (id, secret) = credentials()?;
    let response = reqwest::Client::new().post("https://oauth2.googleapis.com/token").form(&[("client_id", id.as_str()), ("client_secret", secret.as_str()), ("refresh_token", refresh.as_str()), ("grant_type", "refresh_token")]).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() { return Err("YouTube token refresh failed".into()); }
    let value: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    save_token(app, &value)?;
    Ok(value["access_token"].as_str().map(String::from))
}

fn callback(listener: TcpListener, state: String) -> Result<String, String> {
    let (mut stream, _) = listener.accept().map_err(|e| e.to_string())?;
    let mut buffer = [0u8; 8192];
    let size = stream.read(&mut buffer).map_err(|e| e.to_string())?;
    let request = String::from_utf8_lossy(&buffer[..size]);
    let target = request.lines().next().and_then(|line| line.split_whitespace().nth(1)).ok_or("Invalid OAuth callback")?;
    let url = reqwest::Url::parse(&format!("http://localhost{target}")).map_err(|e| e.to_string())?;
    let values: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    if values.get("state") != Some(&state) { return Err("Invalid OAuth state".into()); }
    let code = values.get("code").cloned().ok_or("YouTube authorization was cancelled")?;
    let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\nYouTube connected. You can close this tab.");
    Ok(code)
}

#[tauri::command]
pub async fn get_youtube_auth_url(app: AppHandle) -> Result<AuthUrl, String> {
    if usable_token(&app).await?.is_some() { return Ok(AuthUrl { authorized: true, url: None }); }
    let (id, secret) = credentials()?;
    let listener = TcpListener::bind("127.0.0.1:43827").map_err(|e| format!("Cannot open OAuth callback: {e}"))?;
    let state = format!("{}-{}", now(), std::process::id());
    let callback_state = state.clone();
    let wait = tokio::task::spawn_blocking(move || callback(listener, callback_state));
    let url = reqwest::Url::parse_with_params("https://accounts.google.com/o/oauth2/v2/auth", [("client_id", id.as_str()), ("redirect_uri", REDIRECT_URI), ("response_type", "code"), ("scope", SCOPE), ("access_type", "offline"), ("prompt", "consent"), ("state", state.as_str())]).map_err(|e| e.to_string())?.to_string();
    app.shell().open(&url, None).map_err(|e| format!("Cannot open browser: {e}"))?;
    let code = wait.await.map_err(|e| e.to_string())??;
    let response = reqwest::Client::new().post("https://oauth2.googleapis.com/token").form(&[("code", code.as_str()), ("client_id", id.as_str()), ("client_secret", secret.as_str()), ("redirect_uri", REDIRECT_URI), ("grant_type", "authorization_code")]).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() { return Err("YouTube authorization failed".into()); }
    let value: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    save_token(&app, &value)?;
    Ok(AuthUrl { authorized: true, url: None })
}

#[tauri::command]
pub async fn create_youtube_playlist(app: AppHandle, video_ids: Vec<String>, title: String, skipped: Vec<String>) -> Result<PlaylistResult, String> {
    let token = usable_token(&app).await?.ok_or("Authorize YouTube before creating a playlist")?;
    let ids: Vec<String> = video_ids.into_iter().filter(|id| id.len() >= 6 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')).collect();
    if ids.is_empty() { return Err("No valid YouTube tracks selected".into()); }
    let client = reqwest::Client::new();
    let playlist: serde_json::Value = client.post("https://youtube.googleapis.com/youtube/v3/playlists?part=snippet,status").bearer_auth(&token).json(&serde_json::json!({"snippet": {"title": title.chars().take(150).collect::<String>(), "description": "Created by DJ Prep Tool"}, "status": {"privacyStatus": "private"}})).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|_| "Could not create YouTube playlist".to_string())?.json().await.map_err(|e| e.to_string())?;
    let mut added = 0;
    let mut skipped_ids = skipped;
    for id in &ids {
        let mut added_video = false;
        for attempt in 0..2 {
            let response = client.post("https://youtube.googleapis.com/youtube/v3/playlistItems?part=snippet").bearer_auth(&token).json(&serde_json::json!({"snippet": {"playlistId": playlist["id"], "resourceId": {"kind": "youtube#video", "videoId": id}}})).send().await;
            if response.map(|value| value.status().is_success()).unwrap_or(false) {
                added_video = true;
                break;
            }
            if attempt == 0 {
                tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
            }
        }
        if added_video {
            added += 1;
        } else {
            skipped_ids.push(id.clone());
        }
    }
    Ok(PlaylistResult { playlist_url: format!("https://www.youtube.com/playlist?list={}", playlist["id"].as_str().unwrap_or_default()), added, skipped: skipped_ids })
}
