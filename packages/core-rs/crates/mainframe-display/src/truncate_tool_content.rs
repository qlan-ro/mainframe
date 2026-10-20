//! Adapter-agnostic: truncates an oversized tool-result string for display. No
//! Claude event/JSONL shapes.

pub const TRUNCATE_THRESHOLD_BYTES: usize = 32 * 1024;
const HEAD_LINES: usize = 100;
const TAIL_LINES: usize = 100;

#[derive(Debug, Clone, PartialEq)]
pub struct TruncateResult {
    pub content: String,
    pub truncated: bool,
    pub full_bytes: Option<i64>,
}

pub fn truncate_tool_content(content: &str) -> TruncateResult {
    let full_bytes = content.len();
    if full_bytes <= TRUNCATE_THRESHOLD_BYTES {
        return TruncateResult {
            content: content.to_string(),
            truncated: false,
            full_bytes: None,
        };
    }

    let lines: Vec<&str> = content.split('\n').collect();
    // Round to whole KB, half away from zero (byte counts are non-negative, so
    // this is the same as rounding half up).
    let kb = ((full_bytes as f64) / 1024.0).round() as i64;

    if lines.len() <= HEAD_LINES + TAIL_LINES {
        // Very long single/few-line content: keep the first and last `half`
        // UTF-16 code units.
        let half = TRUNCATE_THRESHOLD_BYTES / 2;
        let head = slice_utf16_prefix(content, half);
        let tail = slice_utf16_suffix(content, half);
        return TruncateResult {
            content: format!("{head}\n…[truncated · {kb} KB — expand]…\n{tail}"),
            truncated: true,
            full_bytes: Some(full_bytes as i64),
        };
    }

    let head = lines[..HEAD_LINES].join("\n");
    let tail = lines[lines.len() - TAIL_LINES..].join("\n");
    let omitted = lines.len() - HEAD_LINES - TAIL_LINES;
    TruncateResult {
        content: format!("{head}\n…[truncated {omitted} lines · {kb} KB — expand]…\n{tail}"),
        truncated: true,
        full_bytes: Some(full_bytes as i64),
    }
}

/// The first `n` UTF-16 code units of `content`; a surrogate pair split at the
/// boundary decodes to U+FFFD.
fn slice_utf16_prefix(content: &str, n: usize) -> String {
    let end = n.min(content.len());
    if content.as_bytes()[..end].is_ascii() {
        return content[..end].to_string();
    }
    let units: Vec<u16> = content.encode_utf16().take(n).collect();
    String::from_utf16_lossy(&units)
}

/// The last `n` UTF-16 code units, preserving a split surrogate as U+FFFD.
fn slice_utf16_suffix(content: &str, n: usize) -> String {
    let start = content.len().saturating_sub(n);
    if content.as_bytes()[start..].is_ascii() {
        return content[start..].to_string();
    }
    let mut units = 0;
    for (offset, character) in content.char_indices().rev() {
        units += character.len_utf16();
        if units > n {
            return format!("\u{fffd}{}", &content[offset + character.len_utf8()..]);
        }
        if units == n {
            return content[offset..].to_string();
        }
    }
    content.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_content_unchanged_below_threshold_no_flag() {
        let small = "line\n".repeat(10);
        let r = truncate_tool_content(&small);
        assert!(!r.truncated);
        assert_eq!(r.content, small);
        assert_eq!(r.full_bytes, None);
    }

    #[test]
    fn truncates_above_threshold_to_head_100_marker_tail_100() {
        let big = (0..5000)
            .map(|i| format!("row {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(big.len() > TRUNCATE_THRESHOLD_BYTES);
        let r = truncate_tool_content(&big);
        assert!(r.truncated);
        assert_eq!(r.full_bytes, Some(big.len() as i64));
        let lines: Vec<&str> = r.content.split('\n').collect();
        assert_eq!(lines[0], "row 0");
        assert_eq!(lines[99], "row 99");
        assert!(r.content.contains("truncated"));
        assert_eq!(lines[lines.len() - 1], "row 4999");
        assert_eq!(lines[lines.len() - 100], "row 4900");
    }

    #[test]
    fn treats_a_string_just_over_the_byte_threshold_as_truncated() {
        let just_over = "x".repeat(TRUNCATE_THRESHOLD_BYTES + 1);
        assert!(truncate_tool_content(&just_over).truncated);
    }

    #[test]
    fn treats_a_string_exactly_at_the_threshold_as_untruncated() {
        let exact = "x".repeat(TRUNCATE_THRESHOLD_BYTES);
        assert!(!truncate_tool_content(&exact).truncated);
    }

    #[test]
    fn edge_slices_match_utf16_at_every_unicode_boundary() {
        for text in ["", "ascii", "é中", "a🦀b😀c", "🦀🦀", "éascii😀", "asciié"] {
            let units: Vec<_> = text.encode_utf16().collect();
            for n in 0..=units.len() + 2 {
                assert_eq!(
                    slice_utf16_prefix(text, n),
                    String::from_utf16_lossy(&units[..n.min(units.len())]),
                    "prefix {text:?} at {n}"
                );
                assert_eq!(
                    slice_utf16_suffix(text, n),
                    String::from_utf16_lossy(&units[units.len().saturating_sub(n)..]),
                    "suffix {text:?} at {n}"
                );
            }
        }
    }

    #[test]
    fn truncation_preserves_split_surrogates_and_ascii_edges_around_unicode() {
        let half = TRUNCATE_THRESHOLD_BYTES / 2;
        for text in [
            format!(
                "{}🦀{}😀{}",
                "a".repeat(half - 1),
                "中".repeat(half),
                "z".repeat(half - 1)
            ),
            format!("{}😀{}", "a".repeat(half), "z".repeat(half)),
        ] {
            let units: Vec<_> = text.encode_utf16().collect();
            let head = String::from_utf16_lossy(&units[..half]);
            let tail = String::from_utf16_lossy(&units[units.len() - half..]);
            let kb = (text.len() as f64 / 1024.0).round() as i64;
            assert_eq!(
                truncate_tool_content(&text),
                TruncateResult {
                    content: format!("{head}\n…[truncated · {kb} KB — expand]…\n{tail}"),
                    truncated: true,
                    full_bytes: Some(text.len() as i64),
                }
            );
        }
    }
}
