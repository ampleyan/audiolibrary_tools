use rusqlite::params;
use tauri::AppHandle;
use tokio::time::{sleep, Duration};

use crate::{config_store, db, import, scoring, sockseek};

use reqwest::StatusCode;

fn make_client(app: &AppHandle) -> sockseek::SockseekClient {
    let url = config_store::get(app, "sockseek_daemon_url")
        .unwrap_or_else(|| "http://127.0.0.1:5030".to_string());
    sockseek::SockseekClient::new(&url)
}

async fn search_with_query(
    app: &AppHandle,
    track_id: i64,
    artist: &str,
    title: &str,
    query_artist: &str,
    query_title: &str,
    relax: bool,
) -> Result<Vec<scoring::RankedCandidate>, String> {
    let client = make_client(app);
    let job_id = client
        .search(query_artist, query_title, None, relax)
        .await
        .map_err(|e| e.to_string())?;

    {
        let conn = db::open(app).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE tracks SET search_job_id = ?1, state = 'matched', error = NULL WHERE id = ?2",
            params![job_id, track_id],
        )
        .map_err(|e| e.to_string())?;
    }

    let mut candidates = Vec::new();
    for _ in 0..60u8 {
        sleep(Duration::from_millis(500)).await;
        if let Ok(c) = client.results(&job_id).await {
            if !c.is_empty() {
                candidates = c;
                break;
            }
        }
        if client.is_terminal(&job_id).await.unwrap_or(false) {
            break;
        }
    }

    let ranked = scoring::rank(candidates, artist, title, None);

    if ranked.is_empty() {
        let conn = db::open(app).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE tracks SET state = 'requested', error = 'No results found — try editing the artist/title or search again later' WHERE id = ?1",
            params![track_id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        let json = serde_json::to_string(&ranked).unwrap_or_default();
        let conn = db::open(app).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE tracks SET state = 'matched', candidate_json = ?1, error = NULL WHERE id = ?2",
            params![json, track_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(ranked)
}

#[tauri::command]
pub async fn search_track(
    app: AppHandle,
    track_id: i64,
) -> Result<Vec<scoring::RankedCandidate>, String> {
    let track = import::get_track(&app, track_id).map_err(|e| e.to_string())?;
    let query_title = match &track.mix_version {
        Some(mv) if !mv.is_empty() => format!("{} {}", track.title, mv),
        _ => track.title.clone(),
    };
    search_with_query(
        &app,
        track_id,
        &track.artist,
        &track.title,
        &track.artist,
        &query_title,
        false,
    )
    .await
}

#[tauri::command]
pub async fn search_track_loose(
    app: AppHandle,
    track_id: i64,
) -> Result<Vec<scoring::RankedCandidate>, String> {
    let track = import::get_track(&app, track_id).map_err(|e| e.to_string())?;
    let query = format!("{} {}", track.artist, track.title);
    search_with_query(&app, track_id, &track.artist, &track.title, "", &query, true).await
}

#[tauri::command]
pub fn approve_candidate(
    app: AppHandle,
    track_id: i64,
    username: String,
    filename: String,
) -> Result<(), String> {
    let conn = db::open(&app).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE tracks SET selected_username = ?1, selected_filename = ?2, state = 'approved' WHERE id = ?3",
        params![username, filename, track_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn start_download(app: AppHandle, track_id: i64) -> Result<(), String> {
    let track = import::get_track(&app, track_id).map_err(|e| e.to_string())?;

    let mut job_id = track
        .search_job_id
        .ok_or("track has no search job — run search first")?;
    let username = track
        .selected_username
        .ok_or("no candidate approved for this track")?;
    let filename = track
        .selected_filename
        .ok_or("no candidate filename for this track")?;

    let client = make_client(&app);
    let dl_result = client.download(&job_id, &username, &filename).await;

    let dl_id = match dl_result {
        Ok(id) => id,
        Err(ref e) if e.status() == Some(StatusCode::NOT_FOUND) => {
            // Search job expired (daemon restarted) — re-search silently then retry
            let query_title = match track.mix_version.as_deref() {
                Some(mv) if !mv.is_empty() => format!("{} {}", track.title, mv),
                _ => track.title.clone(),
            };
            let new_job_id = client
                .search(&track.artist, &query_title, None, false)
                .await
                .map_err(|e| format!("Re-search failed: {e}"))?;

            {
                let conn = db::open(&app).map_err(|e| e.to_string())?;
                conn.execute(
                    "UPDATE tracks SET search_job_id = ?1 WHERE id = ?2",
                    params![new_job_id, track_id],
                )
                .map_err(|e| e.to_string())?;
            }
            job_id = new_job_id;

            for _ in 0..10u8 {
                sleep(Duration::from_secs(3)).await;
                if let Ok(r) = client.results(&job_id).await {
                    if !r.is_empty() {
                        break;
                    }
                }
            }

            client
                .download(&job_id, &username, &filename)
                .await
                .map_err(|e| format!("Download failed after re-search: {e}"))?
        }
        Err(e) => return Err(e.to_string()),
    };

    let conn = db::open(&app).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE tracks SET download_job_id = ?1, state = 'downloading' WHERE id = ?2",
        params![dl_id, track_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
