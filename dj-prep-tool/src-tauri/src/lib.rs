pub mod commands;
pub mod config_store;
pub mod db;
pub mod import;
pub mod quality;
pub mod scoring;
pub mod sockseek;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();
            db::init(&handle)?;
            let daemon_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                let url = config_store::get(&daemon_handle, "sockseek_daemon_url")
                    .unwrap_or_else(|| "http://127.0.0.1:5030".to_string());
                let already_running = reqwest::get(&url).await.is_ok();
                if !already_running {
                    let _ = commands::daemon::launch_sockseek(daemon_handle).await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::import::get_settings,
            commands::import::save_settings,
            commands::import::import_text,
            commands::import::import_csv,
            commands::import::import_youtube,
            commands::import::list_tracks,
            commands::import::list_activity,
            commands::import::update_track_state,
            commands::import::delete_track,
            commands::import::clear_tracks,
            commands::import::update_track,
            commands::cosine::get_similar_tracks,
            commands::search::search_track,
            commands::search::search_track_loose,
            commands::search::approve_candidate,
            commands::search::start_download,
            commands::download::poll_download,
            commands::download::check_download_progress,
            commands::download::cancel_download,
            commands::download::run_quality_check,
            commands::tagging::convert_track,
            commands::tagging::tag_track,
            commands::tagging::open_folder,
            commands::youtube::get_youtube_auth_url,
            commands::youtube::create_youtube_playlist,
            commands::daemon::launch_sockseek,
            commands::daemon::restart_sockseek,
            commands::daemon::check_daemon,
            commands::daemon::validate_setup,
            commands::daemon::backup_database,
            commands::daemon::list_backups,
            commands::daemon::restore_database,
            commands::daemon::get_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running dj-prep application");
}
