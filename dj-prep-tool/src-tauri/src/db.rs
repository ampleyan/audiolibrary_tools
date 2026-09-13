use rusqlite::Connection;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// In dev, returns the audiolibrary_tools/ project root.
/// Resolves via the exe path: src-tauri/target/debug/dj-prep.exe → up 5 = project root.
/// Returns None in release builds (use app data dir instead).
pub fn project_root() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        let exe = std::env::current_exe().ok()?;
        exe.ancestors().nth(4).and_then(|d| d.parent()).map(|p| p.to_path_buf())
    }
    #[cfg(not(debug_assertions))]
    {
        None
    }
}

pub fn db_path(app: &AppHandle) -> PathBuf {
    #[cfg(debug_assertions)]
    {
        if let Some(root) = project_root() {
            let path = root.join("data").join("dj_prep.sqlite");
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir).ok();
            }
            return path;
        }
    }
    let dir = app
        .path()
        .app_local_data_dir()
        .expect("app_local_data_dir must resolve");
    std::fs::create_dir_all(&dir).ok();
    dir.join("dj_prep.sqlite")
}

pub fn open(app: &AppHandle) -> Result<Connection, rusqlite::Error> {
    let path = db_path(app);
    let conn = Connection::open(&path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    Ok(conn)
}

pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let conn = open(app)?;
    conn.execute_batch(SCHEMA)?;
    Ok(())
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS tracks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    artist          TEXT NOT NULL DEFAULT '',
    title           TEXT NOT NULL DEFAULT '',
    mix_version     TEXT,
    source_url      TEXT,
    state           TEXT NOT NULL DEFAULT 'requested',
    candidate_json  TEXT,
    selected_username TEXT,
    selected_filename TEXT,
    downloaded_path TEXT,
    quality_result  TEXT,
    quality_notes   TEXT,
    archive_path    TEXT,
    dj_path         TEXT,
    search_job_id   TEXT,
    download_job_id TEXT,
    error           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS tracks_updated_at
    AFTER UPDATE ON tracks FOR EACH ROW
BEGIN
    UPDATE tracks SET updated_at = datetime('now') WHERE id = NEW.id;
END;
";

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn in_memory() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn
    }

    #[test]
    fn schema_creates_tables() {
        let conn = in_memory();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('tracks','settings')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn track_default_state_is_requested() {
        let conn = in_memory();
        conn.execute(
            "INSERT INTO tracks (artist, title) VALUES ('Surgeon', 'Magneze')",
            [],
        )
        .unwrap();
        let state: String = conn
            .query_row("SELECT state FROM tracks WHERE artist='Surgeon'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(state, "requested");
    }

    #[test]
    fn settings_upsert() {
        let conn = in_memory();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params!["prep_inbox_dir", r"E:\MUSIC"],
        )
        .unwrap();
        let val: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key='prep_inbox_dir'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(val, r"E:\MUSIC");
    }

    #[test]
    fn valid_states_are_accepted() {
        let conn = in_memory();
        let states = [
            "requested",
            "needs_review",
            "matched",
            "approved",
            "downloading",
            "downloaded",
            "quality_failed",
            "picard_pending",
            "ready_for_conversion",
            "dj_ready",
            "rekordbox_pending",
            "failed",
        ];
        for state in states {
            conn.execute(
                "INSERT INTO tracks (artist, title, state) VALUES (?1, 'T', ?2)",
                rusqlite::params![state, state],
            )
            .unwrap();
        }
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tracks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, states.len() as i64);
    }
}
