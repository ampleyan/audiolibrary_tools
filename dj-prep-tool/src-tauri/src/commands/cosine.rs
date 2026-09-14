use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{config_store, db};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarTrack {
    pub artist: String,
    pub title: String,
    #[serde(alias = "mix_version")]
    pub mix_version: Option<String>,
    #[serde(alias = "video_url")]
    pub video_url: Option<String>,
    #[serde(alias = "cosine_id")]
    pub cosine_id: String,
    pub score: f64,
}

#[tauri::command]
pub async fn get_similar_tracks(
    app: AppHandle,
    track_id: i64,
) -> Result<Vec<SimilarTrack>, String> {
    let api_key = config_store::get(&app, "cosine_api_key")
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "cosine_api_key not configured — add it in Settings".to_string())?;

    let (artist, title) = {
        let conn = db::open(&app).map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT artist, title FROM tracks WHERE id = ?1",
            rusqlite::params![track_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .map_err(|e| format!("Track {track_id} not found: {e}"))?
    };

    let python = resolve_python(&app);
    let script = resolve_cosine_fetch(&app);

    let output = tokio::process::Command::new(&python)
        .arg(&script)
        .arg(&artist)
        .arg(&title)
        .env("COSINE_API_KEY", &api_key)
        .output()
        .await
        .map_err(|e| format!("Failed to launch Python ({python:?}): {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("cosine_fetch.py failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut tracks = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let t: SimilarTrack = serde_json::from_str(line)
            .map_err(|e| format!("Invalid JSON from cosine_fetch.py: {e}\nLine: {line}"))?;
        tracks.push(t);
    }
    Ok(tracks)
}

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

fn resolve_cosine_fetch(_app: &AppHandle) -> std::path::PathBuf {
    if let Some(root) = db::project_root() {
        return root.join("dj-prep-tool").join("py").join("cosine_fetch.py");
    }
    let exe = std::env::current_exe().unwrap_or_default();
    exe.parent()
        .unwrap_or(std::path::Path::new("."))
        .join("py")
        .join("cosine_fetch.py")
}
