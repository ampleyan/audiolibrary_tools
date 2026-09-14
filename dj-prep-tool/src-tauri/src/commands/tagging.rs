use rusqlite::params;
use serde::Deserialize;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

use crate::{config_store, db, import::TrackRow};

#[derive(Deserialize)]
struct TagOutput {
    status: String,
    output_path: Option<String>,
    notes: Option<String>,
}

fn tag_state(status: &str) -> (&'static str, Option<&'static str>) {
    match status {
        "accepted" => ("ready_for_rekordbox", None),
        "review" => ("tagging_review", None),
        _ => ("failed", Some("Tagging could not be completed")),
    }
}

fn resolve_python(app: &AppHandle) -> PathBuf {
    if let Some(path) = config_store::get(app, "python_path") {
        let path = PathBuf::from(path);
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
    PathBuf::from("python")
}

fn resolve_tag_helper() -> PathBuf {
    if let Some(root) = db::project_root() {
        return root.join("dj-prep-tool").join("py").join("beets_tag.py");
    }
    let executable = std::env::current_exe().unwrap_or_default();
    executable
        .parent()
        .unwrap_or(Path::new("."))
        .join("py")
        .join("beets_tag.py")
}

fn find_ffmpeg(app: &AppHandle) -> PathBuf {
    if let Some(path) = config_store::get(app, "ffmpeg_path") {
        let p = PathBuf::from(&path);
        if p.exists() {
            return p;
        }
    }
    PathBuf::from("ffmpeg")
}

fn append_log(app: &AppHandle, content: &str) {
    tracing::info!("{content}");
    let log_dir = match app.path().app_log_dir() {
        Ok(d) => d,
        Err(_) => return,
    };
    let _ = std::fs::create_dir_all(&log_dir);
    let log_path = log_dir.join("conversions.log");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        let _ = writeln!(f, "{content}");
        let _ = writeln!(f, "---");
    }
}

fn clean_filename_part(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|character| {
            if "<>:\"/\\|?*".contains(character) || character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn canonical_audio_path(source_path: &Path, artist: &str, title: &str, extension: &str) -> PathBuf {
    let artist = clean_filename_part(artist);
    let title = clean_filename_part(title);
    let stem = match (artist.is_empty(), title.is_empty()) {
        (false, false) => format!("{artist} - {title}"),
        (false, true) => artist,
        (true, false) => title,
        (true, true) => "untitled".to_string(),
    };
    source_path
        .parent()
        .unwrap_or(Path::new("."))
        .join(format!("{stem}.{extension}"))
}

fn normalize_existing_audio_path(
    source_path: &str,
    artist: &str,
    title: &str,
) -> Result<String, String> {
    let source = Path::new(source_path);
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("mp3");
    let target = canonical_audio_path(source, artist, title, extension);
    if target == source {
        return Ok(source_path.to_string());
    }
    if target.exists() {
        return Ok(target.to_string_lossy().to_string());
    }
    std::fs::rename(source, &target)
        .map_err(|error| format!("Could not rename audio file to {}: {error}", target.display()))?;
    Ok(target.to_string_lossy().to_string())
}

async fn convert_to_mp3(
    app: &AppHandle,
    source_path: &str,
    artist: &str,
    title: &str,
) -> Result<String, String> {
    let ffmpeg = find_ffmpeg(app);
    let input = Path::new(source_path);
    let output = canonical_audio_path(input, artist, title, "mp3");
    let output_str = output.to_string_lossy().to_string();
    if input.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("mp3")) {
        let normalized = normalize_existing_audio_path(source_path, artist, title)?;
        crate::commands::daemon::app_log(format!("[tag] source already MP3; skipped conversion: {}", normalized));
        return Ok(normalized);
    }

    let cmd_display = format!(
        "{} -i {:?} -b:a 320k -y {:?}",
        ffmpeg.display(),
        source_path,
        output_str
    );
    append_log(app, &format!("[ffmpeg] running: {cmd_display}"));

    let result = tokio::process::Command::new(&ffmpeg)
        .args(["-i", source_path, "-b:a", "320k", "-y", &output_str])
        .output()
        .await
        .map_err(|e| format!("Failed to start ffmpeg: {e}\nIs ffmpeg installed and in PATH?"))?;

    let stderr = String::from_utf8_lossy(&result.stderr);
    append_log(app, &format!("[ffmpeg] output:\n{stderr}"));

    if !result.status.success() {
        return Err(format!("ffmpeg failed (exit {:?}):\n{stderr}", result.status.code()));
    }

    Ok(output_str)
}

#[tauri::command]
pub async fn convert_track(app: AppHandle, track_id: i64) -> Result<TrackRow, String> {
    let track = crate::import::get_track(&app, track_id)
        .map_err(|_| "Track not found".to_string())?;
    let source_path = track
        .downloaded_path
        .ok_or("No downloaded file — poll_download first")?;
    let mp3_path = convert_to_mp3(&app, &source_path, &track.artist, &track.title).await?;
    let conn = db::open(&app).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE tracks SET downloaded_path = ?1, state = 'converted', quality_result = NULL, quality_notes = NULL, error = NULL WHERE id = ?2",
        params![mp3_path, track_id],
    )
    .map_err(|e| e.to_string())?;
    crate::commands::daemon::app_log(format!("[convert] completed: track {}", track_id));
    crate::import::get_track(&app, track_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn tag_track(app: AppHandle, track_id: i64) -> Result<TrackRow, String> {
    let track =
        crate::import::get_track(&app, track_id).map_err(|_| "Track not found".to_string())?;
    crate::commands::daemon::app_log(format!("[tag] started: {} - {}", track.artist, track.title));

    let source_path = track
        .downloaded_path
        .ok_or("No downloaded file — run poll_download first")?;

    let mp3_path = convert_to_mp3(&app, &source_path, &track.artist, &track.title).await?;

    let beets_path = config_store::get(&app, "beets_path").filter(|v| !v.trim().is_empty());
    let target_directory = config_store::get(&app, "music_library_dir").filter(|v| !v.trim().is_empty());
    let config_directory = config_store::get(&app, "beets_config_dir").filter(|v| !v.trim().is_empty());

    if beets_path.is_none() || target_directory.is_none() || config_directory.is_none() {
        let conn = db::open(&app).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE tracks SET state = 'ready_for_rekordbox', archive_path = ?1, error = NULL WHERE id = ?2",
            params![mp3_path, track_id],
        )
        .map_err(|e| e.to_string())?;
        crate::commands::daemon::app_log(format!("[tag] completed: track {}: ready_for_rekordbox", track_id));
        return crate::import::get_track(&app, track_id).map_err(|e| e.to_string());
    }

    let target_directory = target_directory.unwrap();
    let beets_path = beets_path.unwrap();
    let config_directory = config_directory.unwrap();

    let output = tokio::process::Command::new(resolve_python(&app))
        .arg(resolve_tag_helper())
        .arg(&mp3_path)
        .arg(target_directory)
        .arg(&track.artist)
        .arg(&track.title)
        .arg(track.mix_version.as_deref().unwrap_or_default())
        .arg(config_directory)
        .arg(beets_path)
        .output()
        .await
        .map_err(|e| format!("Failed to start tagging: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let result: TagOutput = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("Tagging script error: {e}\nOutput: {stdout}"))?;

    let (state, error) = tag_state(&result.status);
    let archive_path = if state == "ready_for_rekordbox" {
        let output_path = result
            .output_path
            .filter(|p| !p.trim().is_empty())
            .ok_or("Tagging script returned no output path")?;
        normalize_existing_audio_path(&output_path, &track.artist, &track.title)?
    } else {
        String::new()
    };
    let review_note = result.notes.filter(|n| !n.trim().is_empty());
    let error = error.map(str::to_string).or_else(|| {
        if state == "tagging_review" {
            review_note
        } else {
            None
        }
    });

    let conn = db::open(&app).map_err(|e| e.to_string())?;
    if state == "ready_for_rekordbox" {
        conn.execute(
            "UPDATE tracks SET state = ?1, archive_path = ?2, error = NULL WHERE id = ?3",
            params![state, archive_path, track_id],
        )
    } else {
        conn.execute(
            "UPDATE tracks SET state = ?1, error = ?2 WHERE id = ?3",
            params![state, error, track_id],
        )
    }
    .map_err(|e| e.to_string())?;

    crate::commands::daemon::app_log(format!("[tag] completed: track {}: {}", track_id, state));
    crate::import::get_track(&app, track_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_folder(app: AppHandle, path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let dir = if p.is_file() {
        p.parent()
            .map(|d| d.to_string_lossy().into_owned())
            .unwrap_or(path)
    } else {
        path
    };
    app.shell()
        .open(&dir, None)
        .map_err(|e| format!("Cannot open folder: {e}"))
}
