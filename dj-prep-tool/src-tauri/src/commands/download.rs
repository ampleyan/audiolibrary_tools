use rusqlite::params;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tokio::time::{sleep, Duration};

use crate::{config_store, db, quality, sockseek};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub bytes_on_disk: Option<u64>,
    pub bytes_total: Option<u64>,
}

#[tauri::command]
pub async fn check_download_progress(
    app: AppHandle,
    track_id: i64,
) -> Result<DownloadProgress, String> {
    let (selected_filename, candidate_json) = {
        let conn = db::open(&app).map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT selected_filename, candidate_json FROM tracks WHERE id = ?1",
            params![track_id],
            |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?)),
        )
        .map_err(|e| e.to_string())?
    };

    let raw = selected_filename.unwrap_or_default();
    let basename = raw.replace('\\', "/").split('/').last().unwrap_or(&raw).to_string();

    let bytes_total = candidate_json.and_then(|json| {
        let ranked: Vec<serde_json::Value> = serde_json::from_str(&json).ok()?;
        let base_lower = basename.to_lowercase();
        ranked.iter().find_map(|rc| {
            let c = rc.get("candidate")?;
            let fname = c.get("filename")?.as_str()?;
            let fname_base = fname
                .replace('\\', "/")
                .split('/')
                .last()?
                .to_lowercase();
            if fname_base == base_lower {
                c.get("size")?.as_u64()
            } else {
                None
            }
        })
    });

    let prep_inbox = config_store::get(&app, "prep_inbox_dir").unwrap_or_default();
    let inbox = Path::new(&prep_inbox);
    let bytes_on_disk = ["", ".part", ".incomplete", ".tmp"].iter().find_map(|suffix| {
        let name = format!("{basename}{suffix}");
        std::fs::metadata(inbox.join(&name)).ok().map(|m| m.len())
    });

    Ok(DownloadProgress {
        bytes_on_disk,
        bytes_total,
    })
}

#[tauri::command]
pub async fn cancel_download(app: AppHandle, track_id: i64) -> Result<(), String> {
    let job_id = {
        let conn = db::open(&app).map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT download_job_id FROM tracks WHERE id = ?1",
            params![track_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .map_err(|e| e.to_string())?
        .ok_or("track has no download job")?
    };
    make_client(&app)
        .cancel(&job_id)
        .await
        .map_err(|e| format!("cancel download failed: {e}"))?;
    let conn = db::open(&app).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE tracks SET state = 'failed', error = 'Download cancelled by user' WHERE id = ?1",
        params![track_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn open_in_picard(app: AppHandle, track_id: i64) -> Result<(), String> {
    let picard_path = config_store::get(&app, "picard_path")
        .ok_or("picard_path not configured — check Setup")?;

    let downloaded_path = {
        let conn = db::open(&app).map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT downloaded_path FROM tracks WHERE id = ?1",
            params![track_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .map_err(|e| e.to_string())?
    };

    let file = downloaded_path.ok_or("track has no downloaded file — poll_download first")?;

    std::process::Command::new(&picard_path)
        .arg(&file)
        .spawn()
        .map_err(|e| format!("Failed to launch Picard: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn copy_to_rekordbox(app: AppHandle, track_id: i64) -> Result<String, String> {
    let rekordbox_dir = config_store::get(&app, "rekordbox_import_dir")
        .ok_or("rekordbox_import_dir not configured — check Setup")?;

    let downloaded_path = {
        let conn = db::open(&app).map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT downloaded_path FROM tracks WHERE id = ?1",
            params![track_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .map_err(|e| e.to_string())?
    };

    let src = downloaded_path.ok_or("track has no downloaded file — poll_download first")?;
    let src_path = Path::new(&src);
    let filename = src_path
        .file_name()
        .ok_or("invalid downloaded_path — no filename component")?;
    let dest = Path::new(&rekordbox_dir).join(filename);
    let dest_str = dest.to_string_lossy().to_string();

    std::fs::copy(src_path, &dest).map_err(|e| format!("Copy failed: {e}"))?;

    {
        let conn = db::open(&app).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE tracks SET dj_path = ?1, state = 'dj_ready' WHERE id = ?2",
            params![dest_str, track_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(dest_str)
}

fn make_client(app: &AppHandle) -> sockseek::SockseekClient {
    let url = config_store::get(app, "sockseek_daemon_url")
        .unwrap_or_else(|| "http://127.0.0.1:5030".to_string());
    sockseek::SockseekClient::new(&url)
}

fn basename(remote_path: &str) -> String {
    remote_path
        .replace('\\', "/")
        .split('/')
        .last()
        .unwrap_or(remote_path)
        .to_string()
}

fn find_in_dir(dir: &Path, name: &str) -> Option<PathBuf> {
    let name_lower = name.to_lowercase();
    std::fs::read_dir(dir).ok()?.find_map(|entry| {
        let entry = entry.ok()?;
        let fname = entry.file_name();
        let fname_str = fname.to_string_lossy();
        if fname_str.to_lowercase() == name_lower {
            Some(entry.path())
        } else {
            None
        }
    })
}

struct ActiveDownload {
    dl_job_id: String,
    expected_name: String,
}

fn read_active_download(app: &AppHandle, track_id: i64) -> Result<ActiveDownload, String> {
    let conn = db::open(app).map_err(|e| e.to_string())?;
    let (dl_job_id, selected_filename) = conn
        .query_row(
            "SELECT download_job_id, selected_filename FROM tracks WHERE id = ?1",
            params![track_id],
            |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?)),
        )
        .map_err(|e| e.to_string())?;
    Ok(ActiveDownload {
        dl_job_id: dl_job_id.ok_or("no download job — call start_download first")?,
        expected_name: basename(&selected_filename.ok_or("track has no selected filename")?),
    })
}

/// Try the next ranked candidate when the current download failed.
/// Returns the new ActiveDownload state, or an error if candidates are exhausted.
async fn advance_candidate(
    app: &AppHandle,
    client: &sockseek::SockseekClient,
    track_id: i64,
    failed_username: &str,
    failed_filename: &str,
) -> Result<ActiveDownload, String> {
    let (candidate_json, search_job_id) = {
        let conn = db::open(app).map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT candidate_json, search_job_id FROM tracks WHERE id = ?1",
            params![track_id],
            |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?)),
        )
        .map_err(|e| e.to_string())?
    };

    let ranked: Vec<serde_json::Value> =
        serde_json::from_str(candidate_json.as_deref().unwrap_or("[]"))
            .map_err(|e| format!("bad candidate_json: {e}"))?;

    let job_id = search_job_id.ok_or("no search job — re-search from Review")?;

    let current_pos = ranked.iter().position(|rc| {
        let c = rc.get("candidate").unwrap_or(&serde_json::Value::Null);
        let u = c.get("username").and_then(|v| v.as_str()).unwrap_or("");
        let f = c.get("filename").and_then(|v| v.as_str()).unwrap_or("");
        u.eq_ignore_ascii_case(failed_username)
            && f.eq_ignore_ascii_case(failed_filename)
    });

    let next_idx = match current_pos {
        Some(i) if i + 1 < ranked.len() => i + 1,
        _ => {
            return Err(format!(
                "all {} candidate(s) failed — try re-searching from Review",
                ranked.len()
            ))
        }
    };

    let c = ranked[next_idx]
        .get("candidate")
        .ok_or("malformed candidate")?;
    let next_user = c
        .get("username")
        .and_then(|v| v.as_str())
        .ok_or("no username")?;
    let next_file = c
        .get("filename")
        .and_then(|v| v.as_str())
        .ok_or("no filename")?;

    let new_dl_id = client
        .download(&job_id, next_user, next_file)
        .await
        .map_err(|e| format!("retry download failed: {e}"))?;

    {
        let conn = db::open(app).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE tracks SET selected_username = ?1, selected_filename = ?2, download_job_id = ?3 WHERE id = ?4",
            params![next_user, next_file, new_dl_id, track_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(ActiveDownload {
        dl_job_id: new_dl_id,
        expected_name: basename(next_file),
    })
}

/// Poll until the download job's file appears in prep_inbox_dir, then mark as
/// downloaded and return the local path.  Timeout: 10 minutes.
/// Automatically retries the next ranked candidate if Sockseek reports failure.
#[tauri::command]
pub async fn poll_download(app: AppHandle, track_id: i64) -> Result<String, String> {
    let prep_inbox = config_store::get(&app, "prep_inbox_dir")
        .ok_or("prep_inbox_dir not configured")?;
    let inbox_path = PathBuf::from(&prep_inbox);
    let client = make_client(&app);

    let mut active = read_active_download(&app, track_id)?;

    for _ in 0..120u8 {
        sleep(Duration::from_secs(5)).await;

        if let Some(found) = find_in_dir(&inbox_path, &active.expected_name) {
            let path_str = found.to_string_lossy().to_string();
            let conn = db::open(&app).map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE tracks SET downloaded_path = ?1, state = 'downloaded' WHERE id = ?2",
                params![path_str, track_id],
            )
            .map_err(|e| e.to_string())?;
            return Ok(path_str);
        }

        if let Ok(files) = client.download_results(&active.dl_job_id).await {
            if files.iter().any(|f| f.is_failed()) {
                let (cur_user, cur_file) = {
                    let conn = db::open(&app).map_err(|e| e.to_string())?;
                    conn.query_row(
                        "SELECT selected_username, selected_filename FROM tracks WHERE id = ?1",
                        params![track_id],
                        |r| Ok((
                            r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                            r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        )),
                    )
                    .map_err(|e| e.to_string())?
                };

                match advance_candidate(&app, &client, track_id, &cur_user, &cur_file).await {
                    Ok(next) => {
                        active = next;
                        continue;
                    }
                    Err(e) => {
                        let conn = db::open(&app).map_err(|e| e.to_string())?;
                        conn.execute(
                            "UPDATE tracks SET state = 'failed', error = ?1 WHERE id = ?2",
                            params![e, track_id],
                        )
                        .ok();
                        return Err(e);
                    }
                }
            }
        }
    }

    let error = format!("download timed out after 10 minutes: {}", active.expected_name);
    if let Ok(conn) = db::open(&app) {
        let _ = conn.execute(
            "UPDATE tracks SET state = 'failed', error = ?1 WHERE id = ?2",
            params![error, track_id],
        );
    }
    Err(error)
}

/// Run quality check on the downloaded file and update the track state.
#[tauri::command]
pub async fn run_quality_check(app: AppHandle, track_id: i64) -> Result<quality::QualityResult, String> {
    let downloaded_path = {
        let conn = db::open(&app).map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT downloaded_path FROM tracks WHERE id = ?1",
            params![track_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .map_err(|e| e.to_string())?
    };

    let path = downloaded_path.ok_or("track has no downloaded file — poll_download first")?;
    quality::check_file(&app, track_id, &path).await
}
