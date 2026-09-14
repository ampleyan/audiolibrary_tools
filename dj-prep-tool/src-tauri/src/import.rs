use std::{collections::HashSet, sync::LazyLock};

use regex::Regex;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::db;

// ── Compiled regexes ───────────────────────────────────────────────────────

static RE_BRACKET: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)[\[\(][^\[\(\]\)]*?(official|lyric|hd|hq|4k|video|audio|free\s*download|320kbps)[^\[\(\]\)]*?[\]\)]",
    )
    .unwrap()
});

static RE_PIPE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s*[|/]{1,2}.*$").unwrap());

static RE_TRAILING: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\s+(official\s*(video|audio)|hq|hd)\s*$").unwrap());

static RE_WS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s{2,}").unwrap());

static RE_MIX_VERSION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\s*[\(\[]([\w\s\-'&]* (?:original|extended|radio|club|dub|instrumental|vocal|acapella|vip|remix|rmx|mix|edit|version|rework|bootleg|re-?edit|re-?work|re-?mix))[\)\]]\s*$",
    )
    .unwrap()
});

static RE_TRACK_NUM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\d{1,3}[.\):\-]\s*").unwrap());

static RE_FILE_EXT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\.(mp3|flac|aac|ogg|wav|m4a|aif{1,2}|wma|opus)\s*$").unwrap());

static RE_LIST_PREFIX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:(?:[-*•]\s+)|(?:\d{1,3}(?:[.\):]\s*|\s+-\s+)))+").unwrap()
});

// ── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackDraft {
    pub artist: String,
    pub title: String,
    pub mix_version: Option<String>,
    pub source_url: Option<String>,
    pub import_tag: Option<String>,
    pub state: String,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackRow {
    pub id: i64,
    pub artist: String,
    pub title: String,
    pub mix_version: Option<String>,
    pub source_url: Option<String>,
    pub import_tag: Option<String>,
    pub state: String,
    pub candidate_json: Option<String>,
    pub selected_username: Option<String>,
    pub selected_filename: Option<String>,
    pub downloaded_path: Option<String>,
    pub quality_result: Option<String>,
    pub quality_notes: Option<String>,
    pub archive_path: Option<String>,
    pub dj_path: Option<String>,
    pub search_job_id: Option<String>,
    pub download_job_id: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ── Parsing ────────────────────────────────────────────────────────────────

pub fn clean_title(raw: &str) -> (String, String, bool) {
    let s = RE_BRACKET.replace_all(raw, "");
    let s = RE_PIPE.replace(&s, "");
    let s = RE_TRAILING.replace(&s, "");
    let s = RE_WS.replace_all(&s, " ");
    let s = s.trim().to_string();

    match s.find(" - ") {
        Some(idx) => (
            s[..idx].trim().to_string(),
            s[idx + 3..].trim().to_string(),
            true,
        ),
        None => (String::new(), s, false),
    }
}

fn strip_noise(s: &str) -> String {
    let s = RE_BRACKET.replace_all(s, "");
    let s = RE_PIPE.replace(&s, "");
    let s = RE_TRAILING.replace(&s, "");
    let s = RE_WS.replace_all(&s, " ");
    s.trim().to_string()
}

/// Apply all heuristic cleanups to a CSV row and collect diagnostic notes.
/// Returns (artist, title, mix_version, state, notes).
fn smart_clean(
    raw_artist: &str,
    raw_title: &str,
    raw_mix: Option<&str>,
) -> (String, String, Option<String>, &'static str, Option<String>) {
    let mut artist = raw_artist.trim().trim_start_matches('\u{feff}').to_string();
    let mut title = raw_title.trim().to_string();
    let mut mix = raw_mix
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let mut fixes: Vec<String> = Vec::new();

    // Strip file extension from title
    if RE_FILE_EXT.is_match(&title) {
        let clean = RE_FILE_EXT.replace(&title, "").trim().to_string();
        fixes.push(format!("removed file extension from title"));
        title = clean;
    }

    // Strip leading track number from artist and title
    if RE_TRACK_NUM.is_match(&artist) {
        fixes.push("removed track number from artist".into());
        artist = RE_TRACK_NUM.replace(&artist, "").trim().to_string();
    }
    if RE_TRACK_NUM.is_match(&title) {
        fixes.push("removed track number from title".into());
        title = RE_TRACK_NUM.replace(&title, "").trim().to_string();
    }

    // Strip noise brackets/pipes from title
    let noise_cleaned = strip_noise(&title);
    if noise_cleaned != title {
        fixes.push("stripped noise from title".into());
        title = noise_cleaned;
    }

    if RE_FILE_EXT.is_match(&title) {
        fixes.push("removed file extension from title".into());
        title = RE_FILE_EXT.replace(&title, "").trim().to_string();
    }

    // Combined column: no artist but title contains "Artist - Title"
    if artist.is_empty() {
        if let Some(idx) = title.find(" - ") {
            let a = title[..idx].trim().to_string();
            let t = title[idx + 3..].trim().to_string();
            if !a.is_empty() && !t.is_empty() {
                fixes.push(format!("split combined column → artist: '{a}'"));
                artist = a;
                title = t;
            }
        }
    }

    // Redundant artist prefix in title ("Artist - Title" when artist already set)
    if !artist.is_empty() {
        let prefix = format!("{} - ", artist.to_lowercase());
        if title.to_lowercase().starts_with(&prefix) {
            let stripped = title[prefix.len()..].trim().to_string();
            if !stripped.is_empty() {
                fixes.push("removed redundant artist prefix from title".into());
                title = stripped;
            }
        }
    }

    // Extract mix version from title if not supplied
    if mix.is_none() {
        if let Some(caps) = RE_MIX_VERSION.captures(&title) {
            let extracted = caps.get(1).map(|m| m.as_str().trim().to_string());
            if let Some(mv) = extracted.filter(|s| !s.is_empty()) {
                let clean_title = RE_MIX_VERSION.replace(&title, "").trim().to_string();
                if !clean_title.is_empty() {
                    fixes.push(format!("extracted mix version: '{mv}'"));
                    mix = Some(mv);
                    title = clean_title;
                }
            }
        }
    }

    let state = if artist.is_empty() || title.is_empty() {
        "needs_review"
    } else {
        "requested"
    };

    let notes = if fixes.is_empty() {
        None
    } else {
        Some(fixes.join("; "))
    };

    (artist, title, mix, state, notes)
}

pub fn parse_text(text: &str) -> Vec<TrackDraft> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|line| {
            let line = RE_LIST_PREFIX.replace(line, "").trim().to_string();
            let (raw_artist, raw_title) = [" - ", " – ", " — ", "\t", " : "]
                .iter()
                .filter_map(|separator| line.find(separator).map(|idx| (idx, *separator)))
                .min_by_key(|(idx, _)| *idx)
                .map(|(idx, separator)| {
                    (line[..idx].trim(), line[idx + separator.len()..].trim())
                })
                .unwrap_or(("", line.as_str()));
            let (artist, title, mix_version, state, notes) =
                smart_clean(raw_artist, raw_title, None);
            TrackDraft {
                artist,
                title,
                mix_version,
                source_url: None,
                import_tag: None,
                state: state.into(),
                notes,
            }
        })
        .collect()
}

/// Parse CSV — recognises loose column names, auto-detects combined columns,
/// extracts mix versions, strips track numbers and noise, flags duplicates.
pub fn parse_csv(content: &str) -> Vec<TrackDraft> {
    let content = content.trim_start_matches('\u{feff}');

    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(content.as_bytes());

    let headers = match rdr.headers() {
        Ok(h) => h.clone(),
        Err(_) => return vec![],
    };

    let col = |names: &[&str]| -> Option<usize> {
        names.iter().find_map(|name| {
            headers
                .iter()
                .position(|h| h.trim().eq_ignore_ascii_case(name))
        })
    };

    let artist_idx = col(&["artist", "artist_name", "artist name"]);
    let title_idx = col(&[
        "title",
        "track",
        "track_name",
        "track name",
        "song",
        "name",
    ]);
    let mix_idx = col(&["mix_version", "mix version", "mix", "version", "remix"]);
    let url_idx = col(&["source_url", "url", "link", "youtube_url", "youtube"]);

    let mut drafts: Vec<TrackDraft> = Vec::new();
    let mut seen: HashSet<(String, String)> = HashSet::new();

    for result in rdr.records() {
        let rec = match result {
            Ok(r) => r,
            Err(_) => continue,
        };
        let get = |idx: Option<usize>| -> String {
            idx.and_then(|i| rec.get(i)).unwrap_or("").trim().to_string()
        };
        let opt = |idx: Option<usize>| -> Option<String> {
            let v = get(idx);
            if v.is_empty() { None } else { Some(v) }
        };

        let raw_artist = get(artist_idx);
        let raw_title = get(title_idx);
        let raw_mix = opt(mix_idx);

        if raw_title.is_empty() {
            continue;
        }

        let (artist, title, mix_version, state, mut notes) =
            smart_clean(&raw_artist, &raw_title, raw_mix.as_deref());

        if title.is_empty() {
            continue;
        }

        // Duplicate detection within this import batch
        let key = (artist.to_lowercase(), title.to_lowercase());
        if seen.contains(&key) {
            let dup_note = "duplicate of earlier row in this import".to_string();
            notes = Some(match notes {
                Some(n) => format!("{n}; {dup_note}"),
                None => dup_note,
            });
        } else {
            seen.insert(key);
        }

        drafts.push(TrackDraft {
            state: state.into(),
            artist,
            title,
            mix_version,
            source_url: opt(url_idx),
            import_tag: None,
            notes,
        });
    }
    drafts
}

// ── DB helpers ─────────────────────────────────────────────────────────────

fn map_row(r: &rusqlite::Row) -> rusqlite::Result<TrackRow> {
    Ok(TrackRow {
        id: r.get(0)?,
        artist: r.get(1)?,
        title: r.get(2)?,
        mix_version: r.get(3)?,
        source_url: r.get(4)?,
        import_tag: r.get(5)?,
        state: r.get(6)?,
        candidate_json: r.get(7)?,
        selected_username: r.get(8)?,
        selected_filename: r.get(9)?,
        downloaded_path: r.get(10)?,
        quality_result: r.get(11)?,
        quality_notes: r.get(12)?,
        archive_path: r.get(13)?,
        dj_path: r.get(14)?,
        search_job_id: r.get(15)?,
        download_job_id: r.get(16)?,
        error: r.get(17)?,
        created_at: r.get(18)?,
        updated_at: r.get(19)?,
    })
}

const SELECT_COLS: &str =
    "id, artist, title, mix_version, source_url, import_tag, state,
     candidate_json, selected_username, selected_filename,
     downloaded_path, quality_result, quality_notes,
     archive_path, dj_path, search_job_id, download_job_id,
     error, created_at, updated_at";

pub fn insert_track(app: &AppHandle, draft: &TrackDraft) -> Result<TrackRow, rusqlite::Error> {
    let conn = db::open(app)?;
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM tracks WHERE lower(trim(artist)) = lower(trim(?1)) AND lower(trim(title)) = lower(trim(?2)))",
        params![draft.artist, draft.title],
        |r| r.get(0),
    )?;
    let error = if exists {
        Some(match draft.notes.as_deref() {
            Some(notes) => format!("{notes}; duplicate of existing track"),
            None => "duplicate of existing track".to_string(),
        })
    } else {
        draft.notes.clone()
    };
    conn.execute(
        "INSERT INTO tracks (artist, title, mix_version, source_url, import_tag, state, error)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6)",
        params![
            draft.artist,
            draft.title,
            draft.mix_version,
            draft.source_url,
            draft.state,
            error
        ],
    )?;
    let id = conn.last_insert_rowid();
    conn.query_row(
        &format!("SELECT {SELECT_COLS} FROM tracks WHERE id = ?1"),
        params![id],
        map_row,
    )
}

pub fn track_exists(app: &AppHandle, artist: &str, title: &str) -> Result<bool, rusqlite::Error> {
    let conn = db::open(app)?;
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM tracks WHERE lower(trim(artist)) = lower(trim(?1)) AND lower(trim(title)) = lower(trim(?2)))",
        params![artist, title],
        |row| row.get(0),
    )
}

pub fn list_tracks(
    app: &AppHandle,
    state_filter: Option<&str>,
) -> Result<Vec<TrackRow>, rusqlite::Error> {
    let conn = db::open(app)?;
    match state_filter {
        Some(state) => {
            let mut s = conn.prepare(&format!(
                "SELECT {SELECT_COLS} FROM tracks WHERE state = ?1 ORDER BY created_at DESC"
            ))?;
            let rows: Vec<TrackRow> = s
                .query_map(params![state], map_row)?
                .filter_map(|r| r.ok())
                .collect();
            Ok(rows)
        }
        None => {
            let mut s = conn.prepare(&format!(
                "SELECT {SELECT_COLS} FROM tracks ORDER BY created_at DESC"
            ))?;
            let rows: Vec<TrackRow> = s
                .query_map([], map_row)?
                .filter_map(|r| r.ok())
                .collect();
            Ok(rows)
        }
    }
}

pub fn get_track(app: &AppHandle, id: i64) -> Result<TrackRow, rusqlite::Error> {
    let conn = db::open(app)?;
    conn.query_row(
        &format!("SELECT {SELECT_COLS} FROM tracks WHERE id = ?1"),
        params![id],
        map_row,
    )
}

pub fn update_track_state(app: &AppHandle, id: i64, state: &str) -> Result<(), rusqlite::Error> {
    let conn = db::open(app)?;
    conn.execute(
        "UPDATE tracks SET state = ?1 WHERE id = ?2",
        params![state, id],
    )?;
    Ok(())
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_bracketed_official_video() {
        let (a, t, ok) = clean_title("Surgeon - Magneze [Official Video] [HD]");
        assert_eq!(a, "Surgeon");
        assert_eq!(t, "Magneze");
        assert!(ok);
    }

    #[test]
    fn strips_parenthetical_official_audio() {
        let (a, t, ok) = clean_title("Ancient Methods - Stalker (Official Audio)");
        assert_eq!(a, "Ancient Methods");
        assert_eq!(t, "Stalker");
        assert!(ok);
    }

    #[test]
    fn plain_artist_title_unchanged() {
        let (a, t, ok) = clean_title("Blawan - Getting Me Down");
        assert_eq!(a, "Blawan");
        assert_eq!(t, "Getting Me Down");
        assert!(ok);
    }

    #[test]
    fn no_dash_needs_review() {
        let (a, t, ok) = clean_title("Some Mix Without Dash");
        assert_eq!(a, "");
        assert_eq!(t, "Some Mix Without Dash");
        assert!(!ok);
    }

    #[test]
    fn strips_pipe_label() {
        let (a, t, ok) =
            clean_title("Vatican Shadow - Kneel Before Religious Icons | Hospital Productions");
        assert_eq!(a, "Vatican Shadow");
        assert_eq!(t, "Kneel Before Religious Icons");
        assert!(ok);
    }

    #[test]
    fn strips_4k_bracket() {
        let (a, t, ok) = clean_title("Regis - Mutant Jazz [4K]");
        assert_eq!(a, "Regis");
        assert_eq!(t, "Mutant Jazz");
        assert!(ok);
    }

    #[test]
    fn mix_version_preserved_in_title() {
        let (a, t, ok) = clean_title("Aphex Twin - Windowlicker (Warp Mix)");
        assert_eq!(a, "Aphex Twin");
        assert_eq!(t, "Windowlicker (Warp Mix)");
        assert!(ok);
    }

    #[test]
    fn parse_text_two_tracks() {
        let drafts = parse_text("Surgeon - Magneze\nBlawan - Getting Me Down");
        assert_eq!(drafts.len(), 2);
        assert_eq!(drafts[0].artist, "Surgeon");
        assert_eq!(drafts[0].title, "Magneze");
        assert_eq!(drafts[0].state, "requested");
        assert_eq!(drafts[1].title, "Getting Me Down");
    }

    #[test]
    fn parse_text_skips_blank_and_hash_comments() {
        let drafts = parse_text("\n# comment\n\nSurgeon - Magneze\n");
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].artist, "Surgeon");
    }

    #[test]
    fn parse_text_no_dash_becomes_needs_review() {
        let drafts = parse_text("Some Mix");
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].state, "needs_review");
        assert_eq!(drafts[0].artist, "");
        assert_eq!(drafts[0].title, "Some Mix");
    }

    #[test]
    fn parse_text_strips_noise_inline() {
        let drafts = parse_text("Surgeon - Magneze [Official Video]");
        assert_eq!(drafts[0].title, "Magneze");
    }

    #[test]
    fn parse_text_accepts_common_playlist_separators_and_prefixes() {
        let drafts = parse_text("01. Surgeon – Magneze\n• Blawan — Getting Me Down\nAncient Methods\tStalker");
        assert_eq!(drafts.len(), 3);
        assert_eq!(drafts[0].artist, "Surgeon");
        assert_eq!(drafts[0].title, "Magneze");
        assert_eq!(drafts[1].artist, "Blawan");
        assert_eq!(drafts[1].title, "Getting Me Down");
        assert_eq!(drafts[2].artist, "Ancient Methods");
        assert_eq!(drafts[2].title, "Stalker");
    }

    #[test]
    fn parse_text_extracts_mix_and_file_noise() {
        let drafts = parse_text("02 - Surgeon - Magneze (Original Mix).flac [Official Audio]");
        assert_eq!(drafts[0].artist, "Surgeon");
        assert_eq!(drafts[0].title, "Magneze");
        assert_eq!(drafts[0].mix_version, Some("Original Mix".into()));
    }

    #[test]
    fn parse_text_keeps_ambiguous_lines_for_review() {
        let drafts = parse_text("Some Mix\nhttps://example.com/track");
        assert_eq!(drafts.len(), 2);
        assert!(drafts.iter().all(|draft| draft.state == "needs_review"));
    }

    #[test]
    fn parse_csv_basic_with_mix_version() {
        let csv = "artist,title,mix_version\nSurgeon,Magneze,Original Mix\nBlawan,Getting Me Down,";
        let drafts = parse_csv(csv);
        assert_eq!(drafts.len(), 2);
        assert_eq!(drafts[0].artist, "Surgeon");
        assert_eq!(drafts[0].mix_version, Some("Original Mix".into()));
        assert_eq!(drafts[1].mix_version, None);
        assert_eq!(drafts[1].state, "requested");
    }

    #[test]
    fn parse_csv_empty_artist_needs_review() {
        let csv = "artist,title\n,Some Mix";
        let drafts = parse_csv(csv);
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].state, "needs_review");
    }

    #[test]
    fn parse_csv_skips_row_with_empty_title() {
        let csv = "artist,title\nSurgeon,";
        let drafts = parse_csv(csv);
        assert_eq!(drafts.len(), 0);
    }

    #[test]
    fn parse_csv_with_source_url() {
        let csv = "artist,title,source_url\nSurgeon,Magneze,https://yt.com/x";
        let drafts = parse_csv(csv);
        assert_eq!(drafts[0].source_url, Some("https://yt.com/x".into()));
    }

    #[test]
    fn parse_csv_case_insensitive_headers() {
        let csv = "Artist,Title\nSurgeon,Magneze";
        let drafts = parse_csv(csv);
        assert_eq!(drafts[0].artist, "Surgeon");
    }

    // ── smart_clean ───────────────────────────────────────────────────────

    #[test]
    fn smart_splits_combined_column() {
        let csv = "title\nDerailleur - New Science";
        let drafts = parse_csv(csv);
        assert_eq!(drafts[0].artist, "Derailleur");
        assert_eq!(drafts[0].title, "New Science");
        assert_eq!(drafts[0].state, "requested");
        assert!(drafts[0].notes.as_deref().unwrap_or("").contains("split combined column"));
    }

    #[test]
    fn smart_extracts_mix_version_from_title() {
        let csv = "artist,title\nSurgeon,Magneze (Original Mix)";
        let drafts = parse_csv(csv);
        assert_eq!(drafts[0].title, "Magneze");
        assert_eq!(drafts[0].mix_version, Some("Original Mix".into()));
        assert!(drafts[0].notes.as_deref().unwrap_or("").contains("mix version"));
    }

    #[test]
    fn smart_strips_file_extension() {
        let csv = "artist,title\nSurgeon,Magneze.flac";
        let drafts = parse_csv(csv);
        assert_eq!(drafts[0].title, "Magneze");
        assert!(drafts[0].notes.as_deref().unwrap_or("").contains("extension"));
    }

    #[test]
    fn smart_strips_track_number() {
        let csv = "artist,title\n01. Surgeon,Magneze";
        let drafts = parse_csv(csv);
        assert_eq!(drafts[0].artist, "Surgeon");
        assert!(drafts[0].notes.as_deref().unwrap_or("").contains("track number"));
    }

    #[test]
    fn smart_removes_redundant_artist_in_title() {
        let csv = "artist,title\nSurgeon,Surgeon - Magneze";
        let drafts = parse_csv(csv);
        assert_eq!(drafts[0].title, "Magneze");
        assert!(drafts[0].notes.as_deref().unwrap_or("").contains("redundant"));
    }

    #[test]
    fn smart_flags_duplicate_within_batch() {
        let csv = "artist,title\nSurgeon,Magneze\nSurgeon,Magneze";
        let drafts = parse_csv(csv);
        assert_eq!(drafts.len(), 2);
        assert!(drafts[1].notes.as_deref().unwrap_or("").contains("duplicate"));
    }

    #[test]
    fn smart_accepts_alias_headers() {
        let csv = "artist_name,track_name\nSurgeon,Magneze";
        let drafts = parse_csv(csv);
        assert_eq!(drafts[0].artist, "Surgeon");
        assert_eq!(drafts[0].title, "Magneze");
    }

    #[test]
    fn smart_extracts_remix_bracket() {
        let csv = "artist,title\nBlawan,Getting Me Down [Ben Sims Remix]";
        let drafts = parse_csv(csv);
        assert_eq!(drafts[0].title, "Getting Me Down");
        assert_eq!(drafts[0].mix_version, Some("Ben Sims Remix".into()));
    }

    #[test]
    fn clean_row_without_issues_has_no_notes() {
        let csv = "artist,title\nSurgeon,Magneze";
        let drafts = parse_csv(csv);
        assert!(drafts[0].notes.is_none());
    }
}
