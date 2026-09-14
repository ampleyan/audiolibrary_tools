use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RekordboxTrack {
    pub artist: String,
    pub title: String,
    pub mix_version: Option<String>,
    pub location: Option<String>,
    pub in_library: bool,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub bpm: Option<String>,
    pub key: Option<String>,
    pub rating: Option<String>,
    pub play_count: Option<String>,
    pub date_added: Option<String>,
    pub playlists: Vec<String>,
}

pub fn parse_tracks(xml: &str) -> Vec<RekordboxTrack> {
    let track_tag = Regex::new(r#"<TRACK\b[^>]*>"#).expect("valid track tag pattern");
    let artist_attr = Regex::new(r#"\bArtist\s*=\s*"([^"]*)""#).expect("valid artist pattern");
    let title_attr = Regex::new(r#"\bName\s*=\s*"([^"]*)""#).expect("valid title pattern");
    let mix_attr = Regex::new(r#"\bMix\s*=\s*"([^"]*)""#).expect("valid mix pattern");
    let location_attr = Regex::new(r#"\bLocation\s*=\s*"([^"]*)""#).expect("valid location pattern");
    let album_attr = Regex::new(r#"\bAlbum\s*=\s*"([^"]*)""#).expect("valid album pattern");
    let genre_attr = Regex::new(r#"\bGenre\s*=\s*"([^"]*)""#).expect("valid genre pattern");
    let bpm_attr = Regex::new(r#"\bAverageBpm\s*=\s*"([^"]*)""#).expect("valid bpm pattern");
    let key_attr = Regex::new(r#"\bTonality\s*=\s*"([^"]*)""#).expect("valid key pattern");
    let rating_attr = Regex::new(r#"\bRating\s*=\s*"([^"]*)""#).expect("valid rating pattern");
    let play_count_attr = Regex::new(r#"\bPlayCount\s*=\s*"([^"]*)""#).expect("valid play count pattern");
    let date_added_attr = Regex::new(r#"\bDateAdded\s*=\s*"([^"]*)""#).expect("valid date added pattern");
    let track_id_attr = Regex::new(r#"\bTrackID\s*=\s*"([^"]*)""#).expect("valid track id pattern");

    let tracks = track_tag
        .find_iter(xml)
        .filter_map(|tag| {
            let value = |pattern: &Regex| {
                pattern
                    .captures(tag.as_str())
                    .and_then(|captures| captures.get(1))
                    .map(|capture| decode_entities(capture.as_str()))
                    .filter(|value| !value.is_empty())
            };
            let artist = value(&artist_attr)?;
            let title = value(&title_attr)?;
            let track = RekordboxTrack {
                artist,
                title,
                mix_version: value(&mix_attr),
                location: value(&location_attr),
                in_library: false,
                album: value(&album_attr),
                genre: value(&genre_attr),
                bpm: value(&bpm_attr),
                key: value(&key_attr),
                rating: value(&rating_attr),
                play_count: value(&play_count_attr),
                date_added: value(&date_added_attr),
                playlists: Vec::new(),
            };
            let id = track_id_attr
                .captures(tag.as_str())
                .and_then(|captures| captures.get(1))
                .map(|capture| decode_entities(capture.as_str()));
            Some((id, track))
        })
        .collect::<Vec<_>>();
    let playlists = parse_playlists(xml);

    tracks.into_iter().map(|(id, mut track)| {
        if let Some(id) = id {
            track.playlists = playlists.get(&id).cloned().unwrap_or_default();
        }
        track
    }).collect()
}

fn parse_playlists(xml: &str) -> std::collections::HashMap<String, Vec<String>> {
    let start = match xml.find("<PLAYLISTS") {
        Some(index) => index,
        None => return std::collections::HashMap::new(),
    };
    let tag_pattern = Regex::new(r#"</?NODE\b[^>]*?/?>|<TRACK\b[^>]*?/?>"#).expect("valid playlist tag pattern");
    let name_attr = Regex::new(r#"\bName\s*=\s*"([^"]*)""#).expect("valid playlist name pattern");
    let key_attr = Regex::new(r#"\bKey\s*=\s*"([^"]*)""#).expect("valid playlist key pattern");
    let mut path = Vec::new();
    let mut result = std::collections::HashMap::new();

    for tag in tag_pattern.find_iter(&xml[start..]) {
        let value = tag.as_str();
        if value.starts_with("</NODE") {
            path.pop();
        } else if value.starts_with("<NODE") {
            if let Some(name) = name_attr.captures(value).and_then(|captures| captures.get(1)) {
                let name = decode_entities(name.as_str());
                if name != "ROOT" {
                    path.push(name);
                }
            }
            if value.ends_with("/>") {
                path.pop();
            }
        } else if let Some(key) = key_attr.captures(value).and_then(|captures| captures.get(1)) {
            if !path.is_empty() {
                result.insert(decode_entities(key.as_str()), path.clone());
            }
        }
    }
    result
}

pub fn matching_track_ids(xml: &str, tracks: &[(i64, String, String)]) -> Vec<i64> {
    let rekordbox_tracks: Vec<(String, String)> = parse_tracks(xml)
        .iter()
        .map(|track| (normalize(&track.artist), normalize(&track.title)))
        .collect();

    tracks
        .iter()
        .filter(|(_, artist, title)| {
            let artist = normalize(artist);
            let title = normalize(title);
            rekordbox_tracks
                .iter()
                .any(|(known_artist, known_title)| *known_artist == artist && *known_title == title)
        })
        .map(|(id, _, _)| *id)
        .collect()
}

pub fn matching_location(xml: &str, artist: &str, title: &str) -> Option<String> {
    let expected_artist = normalize(artist);
    let expected_title = normalize(title);

    parse_tracks(xml).into_iter().find_map(|track| {
        if normalize(&track.artist) == expected_artist && normalize(&track.title) == expected_title {
            track.location
        } else {
            None
        }
    })
}

pub fn normalize(value: &str) -> String {
    decode_entities(value)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn decode_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

#[cfg(test)]
mod tests {
    use super::{matching_location, matching_track_ids, parse_tracks};

    #[test]
    fn parses_rekordbox_track_rows_with_multiline_attributes() {
        let xml = r#"<COLLECTION><TRACK TrackID="1" Name="Track &amp; One"
            Artist="Artist &amp; One" Mix="Original Mix" Location="file://localhost/Music/track.mp3"/></COLLECTION><PLAYLISTS><NODE><TRACK Key="1"/></NODE></PLAYLISTS>"#;

        let tracks = parse_tracks(xml);

        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].artist, "Artist & One");
        assert_eq!(tracks[0].title, "Track & One");
        assert_eq!(tracks[0].mix_version, Some("Original Mix".to_string()));
        assert_eq!(tracks[0].location, Some("file://localhost/Music/track.mp3".to_string()));
    }

    #[test]
    fn parses_dj_metadata_and_playlist_membership() {
        let xml = r#"<DJ_PLAYLISTS><COLLECTION><TRACK TrackID="9" Name="Track" Artist="Artist" Album="Album" Genre="House" AverageBpm="124.00" Tonality="8A" Rating="255" PlayCount="4" DateAdded="2024-01-02"/></COLLECTION><PLAYLISTS><NODE Name="ROOT"><NODE Name="Favorites"><TRACK Key="9"/></NODE></NODE></PLAYLISTS></DJ_PLAYLISTS>"#;

        let tracks = parse_tracks(xml);

        assert_eq!(tracks[0].album, Some("Album".to_string()));
        assert_eq!(tracks[0].genre, Some("House".to_string()));
        assert_eq!(tracks[0].bpm, Some("124.00".to_string()));
        assert_eq!(tracks[0].key, Some("8A".to_string()));
        assert_eq!(tracks[0].rating, Some("255".to_string()));
        assert_eq!(tracks[0].play_count, Some("4".to_string()));
        assert_eq!(tracks[0].date_added, Some("2024-01-02".to_string()));
        assert_eq!(tracks[0].playlists, vec!["Favorites"]);
    }

    #[test]
    fn matches_rekordbox_tracks_by_artist_and_title() {
        let xml = r#"<COLLECTION><TRACK Artist="Luke Vibert" Name="StupH"/><TRACK Artist="Other" Name="Track"/></COLLECTION>"#;
        let tracks = vec![
            (1, "Luke Vibert".to_string(), "StupH".to_string()),
            (2, "Missing".to_string(), "Track".to_string()),
        ];

        assert_eq!(matching_track_ids(xml, &tracks), vec![1]);
    }

    #[test]
    fn decodes_xml_entities_and_ignores_case_and_spacing() {
        let xml = r#"<TRACK Artist="The &amp; Band" Name="  Can&#39;t Stop  "/><TRACK Artist="Other" Name="Track"/>"#;
        let tracks = vec![(7, " the & band ".to_string(), "can't stop".to_string())];

        assert_eq!(matching_track_ids(xml, &tracks), vec![7]);
    }

    #[test]
    fn returns_existing_rekordbox_location() {
        let xml = r#"<TRACK Artist="Luke Vibert" Name="StupH" Location="file://localhost/Music/Luke%20Vibert/StupH.mp3"/>"#;

        assert_eq!(
            matching_location(xml, "Luke Vibert", "StupH"),
            Some("file://localhost/Music/Luke%20Vibert/StupH.mp3".to_string())
        );
    }
}
