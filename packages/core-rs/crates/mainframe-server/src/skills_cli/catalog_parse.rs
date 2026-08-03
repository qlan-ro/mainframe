//! Extracts the ranked skill list skills.sh server-renders into its homepage.
//!
//! The registry publishes no endpoint for its leaderboard, but its Next.js
//! page embeds the whole ranking as an `initialSkills` prop inside a React
//! flight payload — a JSON document escaped into a JS string literal. This
//! module unescapes that literal and takes the array by bracket-matched scan.
//! It is a scrape of someone else's implementation detail, so every failure
//! path returns `None` and the caller degrades to search-only.

use super::CatalogEntry;

/// Chars of the escaped payload we're willing to unescape while looking for
/// the end of the array. The real one runs ~100 KB; this leaves room for it to
/// grow several times over without unescaping the whole document.
const MAX_SCAN_CHARS: usize = 1_000_000;

const PROP_KEY: &str = "initialSkills";

#[derive(serde::Deserialize)]
struct RawCatalogEntry {
    source: String,
    #[serde(rename = "skillId")]
    skill_id: String,
    name: String,
    installs: u64,
    #[serde(rename = "weeklyInstalls")]
    weekly_installs: Option<Vec<u64>>,
    // Omitted rather than serialized as `false` for the majority of entries.
    #[serde(default, rename = "isOfficial")]
    is_official: bool,
}

/// `None` when the prop is missing, the payload is truncated, or the extracted
/// slice isn't the array shape we expect — all of which mean the page changed.
pub fn extract_initial_skills(html: &str) -> Option<Vec<CatalogEntry>> {
    let key_at = html.find(PROP_KEY)?;
    let array_at = key_at + html[key_at..].find('[')?;
    let unescaped = unescape_js_string(&html[array_at..], MAX_SCAN_CHARS);
    let array = take_bracketed_array(&unescaped)?;
    let raw: Vec<RawCatalogEntry> = serde_json::from_str(array).ok()?;
    Some(raw.into_iter().map(entry_from).collect())
}

fn entry_from(raw: RawCatalogEntry) -> CatalogEntry {
    CatalogEntry {
        source: raw.source,
        skill_id: raw.skill_id,
        name: raw.name,
        installs: raw.installs,
        weekly_installs: raw.weekly_installs,
        is_official: raw.is_official,
    }
}

/// Reverses the escaping applied when JSON is embedded in a JS string literal.
/// Unrecognized escapes (`\uXXXX` above all) are passed through untouched —
/// JSON understands them, so `serde_json` decodes them a step later.
fn unescape_js_string(input: &str, limit: usize) -> String {
    let mut out = String::with_capacity(input.len().min(limit));
    let mut chars = input.chars();
    while out.len() < limit {
        let Some(c) = chars.next() else { break };
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('"') => out.push('"'),
            Some('\\') => out.push('\\'),
            Some('n') => out.push('\n'),
            Some('/') => out.push('/'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

/// The leading `[…]` of `input`, matched by depth while respecting JSON string
/// literals — a regex would stop at the first `]`, and every entry carries a
/// `weeklyInstalls` array of its own.
fn take_bracketed_array(input: &str) -> Option<&str> {
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (idx, c) in input.char_indices() {
        if in_string {
            match c {
                _ if escaped => escaped = false,
                '\\' => escaped = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match c {
            '"' => in_string = true,
            '[' => depth += 1,
            ']' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(&input[..=idx]);
                }
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_payload_without_the_prop_yields_nothing() {
        assert!(extract_initial_skills("<html><body>nothing here</body></html>").is_none());
    }

    #[test]
    fn an_unterminated_array_yields_nothing_rather_than_a_partial_list() {
        let truncated = r#"{\"initialSkills\":[{\"source\":\"a/b\",\"skillId\":\"c\""#;
        assert!(extract_initial_skills(truncated).is_none());
    }

    #[test]
    fn nested_arrays_do_not_end_the_scan_early() {
        let payload = r#"\"initialSkills\":[{\"source\":\"a/b\",\"skillId\":\"c\",\"name\":\"c\",\"installs\":7,\"weeklyInstalls\":[1,2]}]}"#;
        let entries = extract_initial_skills(payload).expect("entries parse");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].weekly_installs, Some(vec![1, 2]));
    }
}
