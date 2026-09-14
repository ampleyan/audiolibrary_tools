use regex::Regex;

pub fn matching_track_ids(xml: &str, tracks: &[(i64, String, String)]) -> Vec<i64> {
    let track_tag = Regex::new(r#"<TRACK\b[^>]*>"#).expect("valid track tag pattern");
    let artist_attr = Regex::new(r#"\bArtist\s*=\s*"([^"]*)""#).expect("valid artist pattern");
    let title_attr = Regex::new(r#"\bName\s*=\s*"([^"]*)""#).expect("valid title pattern");
    let rekordbox_tracks: Vec<(String, String)> = track_tag
        .find_iter(xml)
        .filter_map(|tag| {
            let artist = artist_attr.captures(tag.as_str())?.get(1)?.as_str();
            let title = title_attr.captures(tag.as_str())?.get(1)?.as_str();
            Some((normalize(artist), normalize(title)))
        })
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
    let track_tag = Regex::new(r#"<TRACK\b[^>]*>"#).expect("valid track tag pattern");
    let artist_attr = Regex::new(r#"\bArtist\s*=\s*"([^"]*)""#).expect("valid artist pattern");
    let title_attr = Regex::new(r#"\bName\s*=\s*"([^"]*)""#).expect("valid title pattern");
    let location_attr = Regex::new(r#"\bLocation\s*=\s*"([^"]*)""#).expect("valid location pattern");
    let expected_artist = normalize(artist);
    let expected_title = normalize(title);

    let location = track_tag.find_iter(xml).find_map(|tag| {
        let known_artist = normalize(artist_attr.captures(tag.as_str())?.get(1)?.as_str());
        let known_title = normalize(title_attr.captures(tag.as_str())?.get(1)?.as_str());
        if known_artist != expected_artist || known_title != expected_title {
            return None;
        }
        Some(decode_entities(location_attr.captures(tag.as_str())?.get(1)?.as_str()))
    });
    location
}

fn normalize(value: &str) -> String {
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
    use super::{matching_track_ids, matching_location};

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
