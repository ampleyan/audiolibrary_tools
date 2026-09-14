use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub username: String,
    pub filename: String,
    pub bit_rate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub length: Option<u32>,
    pub extension: String,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedCandidate {
    pub candidate: Candidate,
    pub score: u32,
}

fn acceptable_candidate(c: &Candidate) -> bool {
    match c.extension.to_lowercase().as_str() {
        "flac" | "wav" | "aiff" | "aif" => true,
        "mp3" => c.bit_rate.is_some_and(|bit_rate| bit_rate >= 320),
        _ => false,
    }
}

pub fn score_candidate(c: &Candidate, artist: &str, title: &str, expected_secs: Option<u32>) -> u32 {
    let mut pts = 0u32;

    match c.extension.to_lowercase().as_str() {
        "flac" => pts += 100,
        "mp3" => pts += 50,
        _ => pts += 10,
    }

    if c.extension.to_lowercase() == "mp3" {
        match c.bit_rate {
            Some(b) if b >= 320 => pts += 30,
            Some(b) if b >= 256 => pts += 20,
            Some(b) if b >= 192 => pts += 10,
            _ => {}
        }
    }

    pts += filename_score(&c.filename, artist, title);

    if let (Some(actual), Some(expected)) = (c.length, expected_secs) {
        let diff = actual.abs_diff(expected);
        if diff <= 5 {
            pts += 20;
        } else if diff <= 15 {
            pts += 10;
        }
    }

    pts
}

fn filename_score(filename: &str, artist: &str, title: &str) -> u32 {
    let fname = filename.to_lowercase();
    let artist_l = artist.to_lowercase();
    let title_l = title.to_lowercase();
    let mut pts = 0u32;

    if !artist_l.is_empty() && fname.contains(&artist_l) {
        pts += 15;
    }
    if !title_l.is_empty() && fname.contains(&title_l) {
        pts += 15;
    }

    let words: Vec<&str> = title_l.split_whitespace().collect();
    if !words.is_empty() {
        let matched = words.iter().filter(|&&w| fname.contains(w)).count();
        pts += (matched * 10 / words.len()) as u32;
    }

    pts
}

pub fn rank(
    candidates: Vec<Candidate>,
    artist: &str,
    title: &str,
    expected_secs: Option<u32>,
) -> Vec<RankedCandidate> {
    let mut ranked: Vec<RankedCandidate> = candidates
        .into_iter()
        .filter(acceptable_candidate)
        .map(|c| {
            let s = score_candidate(&c, artist, title, expected_secs);
            RankedCandidate { candidate: c, score: s }
        })
        .collect();
    ranked.sort_by(|a, b| b.score.cmp(&a.score));
    ranked
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make(ext: &str, bit_rate: Option<u32>, filename: &str, length: Option<u32>) -> Candidate {
        Candidate {
            username: "user".into(),
            filename: filename.into(),
            bit_rate,
            sample_rate: None,
            length,
            extension: ext.into(),
            size: None,
        }
    }

    #[test]
    fn flac_beats_mp3_320() {
        let flac = make("flac", None, "surgeon - magneze.flac", None);
        let mp3 = make("mp3", Some(320), "surgeon - magneze.mp3", None);
        assert!(
            score_candidate(&flac, "Surgeon", "Magneze", None)
                > score_candidate(&mp3, "Surgeon", "Magneze", None)
        );
    }

    #[test]
    fn mp3_320_beats_mp3_128() {
        let hi = make("mp3", Some(320), "track.mp3", None);
        let lo = make("mp3", Some(128), "track.mp3", None);
        assert!(score_candidate(&hi, "A", "T", None) > score_candidate(&lo, "A", "T", None));
    }

    #[test]
    fn filename_match_adds_points() {
        let matched = make("mp3", Some(320), "surgeon - magneze.mp3", None);
        let unmatched = make("mp3", Some(320), "unknown - unknown.mp3", None);
        assert!(
            score_candidate(&matched, "Surgeon", "Magneze", None)
                > score_candidate(&unmatched, "Surgeon", "Magneze", None)
        );
    }

    #[test]
    fn length_within_5s_adds_20() {
        let close = make("mp3", Some(320), "t.mp3", Some(303));
        let far = make("mp3", Some(320), "t.mp3", Some(400));
        let s_close = score_candidate(&close, "A", "T", Some(300));
        let s_far = score_candidate(&far, "A", "T", Some(300));
        assert_eq!(s_close - s_far, 20);
    }

    #[test]
    fn length_6_to_15s_adds_10() {
        let mid = make("mp3", Some(320), "t.mp3", Some(310));
        let far = make("mp3", Some(320), "t.mp3", Some(400));
        let s_mid = score_candidate(&mid, "A", "T", Some(300));
        let s_far = score_candidate(&far, "A", "T", Some(300));
        assert_eq!(s_mid - s_far, 10);
    }

    #[test]
    fn rank_puts_flac_first() {
        let candidates = vec![
            make("mp3", Some(128), "a.mp3", None),
            make("flac", None, "surgeon - magneze.flac", Some(300)),
            make("mp3", Some(320), "surgeon - magneze.mp3", Some(300)),
        ];
        let ranked = rank(candidates, "Surgeon", "Magneze", Some(300));
        assert_eq!(ranked[0].candidate.extension, "flac");
    }

    #[test]
    fn rank_excludes_lossy_candidates_below_320_kbps() {
        let candidates = vec![
            make("mp3", Some(128), "surgeon - magneze.mp3", None),
            make("mp3", Some(320), "surgeon - magneze.mp3", None),
            make("wav", None, "surgeon - magneze.wav", None),
            make("aiff", None, "surgeon - magneze.aiff", None),
        ];
        let ranked = rank(candidates, "Surgeon", "Magneze", None);
        assert_eq!(ranked.len(), 3);
        assert!(ranked.iter().all(|rc| rc.candidate.bit_rate != Some(128)));
    }

    #[test]
    fn unknown_extension_scores_10() {
        let c = make("aac", None, "xyz.aac", None);
        assert_eq!(score_candidate(&c, "Surgeon", "Magneze", None), 10);
    }

    #[test]
    fn empty_artist_still_scores_title() {
        let c = make("mp3", Some(320), "magneze.mp3", None);
        let s = score_candidate(&c, "", "magneze", None);
        assert!(s > 50);
    }
}
