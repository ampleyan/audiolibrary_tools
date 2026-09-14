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
    crate::commands::daemon::app_log(format!("[search] started: {} - {}", artist, title));
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
        crate::commands::daemon::app_log(format!("[search] completed: {} - {}: no results", artist, title));
        let conn = db::open(app).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE tracks SET state = 'requested', error = 'No results found — try editing the artist/title or search again later' WHERE id = ?1",
            params![track_id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        crate::commands::daemon::app_log(format!("[search] completed: {} - {}: {} candidates", artist, title, ranked.len()));
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
    crate::commands::daemon::app_log(format!("[review] approved candidate for track {}", track_id));
    Ok(())
}

async fn refresh_candidate_and_download(
    app: &AppHandle,
    client: &sockseek::SockseekClient,
    track_id: i64,
    track: &import::TrackRow,
) -> Result<(String, String, String), String> {
    let query_title = match track.mix_version.as_deref() {
        Some(mv) if !mv.is_empty() => format!("{} {}", track.title, mv),
        _ => track.title.clone(),
    };
    let ranked = search_with_query(
        app,
        track_id,
        &track.artist,
        &track.title,
        &track.artist,
        &query_title,
        false,
    )
    .await?;
    let best = ranked
        .first()
        .ok_or("Search results expired and no replacement candidate was found")?;
    let username = best.candidate.username.clone();
    let filename = best.candidate.filename.clone();
    let refreshed = import::get_track(app, track_id).map_err(|e| e.to_string())?;
    let job_id = refreshed
        .search_job_id
        .ok_or("Re-search completed without a search job")?;
    let download_id = client
        .download(&job_id, &username, &filename)
        .await
        .map_err(|e| format!("Download failed after refreshing search results: {e}"))?;
    Ok((download_id, username, filename))
}

#[tauri::command]
pub async fn start_download(app: AppHandle, track_id: i64) -> Result<(), String> {
    let track = import::get_track(&app, track_id).map_err(|e| e.to_string())?;
    crate::commands::daemon::app_log(format!("[download] started: {} - {}", track.artist, track.title));

    let job_id = track
        .search_job_id
        .clone()
        .ok_or("track has no search job — run search first")?;
    let username = track
        .selected_username
        .clone()
        .ok_or("no candidate approved for this track")?;
    let filename = track
        .selected_filename
        .clone()
        .ok_or("no candidate filename for this track")?;

    let client = make_client(&app);
    let dl_result = client.download(&job_id, &username, &filename).await;

    let (dl_id, selected_username, selected_filename, recovery_message) = match dl_result {
        Ok(id) => (id, username, filename, None),
        Err(ref e) if matches!(e.status(), Some(StatusCode::BAD_REQUEST) | Some(StatusCode::NOT_FOUND)) => {
            let (id, fresh_username, fresh_filename) =
                refresh_candidate_and_download(&app, &client, track_id, &track).await?;
            (
                id,
                fresh_username,
                fresh_filename,
                Some("Search results expired; refreshed candidate"),
            )
        }
        Err(e) => return Err(e.to_string()),
    };

    let conn = db::open(&app).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE tracks SET selected_username = ?1, selected_filename = ?2, download_job_id = ?3, state = 'downloading', error = ?4 WHERE id = ?5",
        params![selected_username, selected_filename, dl_id, recovery_message, track_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
