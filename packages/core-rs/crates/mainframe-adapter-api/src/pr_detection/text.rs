//! Hand-rolled scanning primitives (no `regex` crate — §8 allowlist). Shared by
//! `parse.rs` (URL scanning) and `command.rs` (word-sequence command matching).

use super::DetectedPrCore;

/// `\w` — the ASCII word-char class (`[A-Za-z0-9_]`).
fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// `\b` — a word boundary sits at `pos` when exactly one side is a word char.
pub(super) fn boundary_at(chars: &[char], pos: usize) -> bool {
    let before = pos > 0 && is_word_char(chars[pos - 1]);
    let after = pos < chars.len() && is_word_char(chars[pos]);
    before != after
}

/// `([^/\s]+)` — read one-or-more non-slash, non-whitespace chars; returns the
/// segment and the remaining suffix, or `None` when empty.
pub(super) fn read_segment(s: &str) -> Option<(&str, &str)> {
    let end = s
        .find(|c: char| c == '/' || c.is_whitespace())
        .unwrap_or(s.len());
    if end == 0 {
        return None;
    }
    Some((&s[..end], &s[end..]))
}

/// `(\d+)` — read one-or-more ASCII digits; returns the digit run and the suffix.
pub(super) fn read_digits(s: &str) -> Option<(&str, &str)> {
    let end = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    if end == 0 {
        return None;
    }
    Some((&s[..end], &s[end..]))
}

/// `\b w0 \s+ w1 \s+ ... wN \b` — the whole word-sequence bounded on both ends.
pub(super) fn has_word_sequence(hay: &str, words: &[&str]) -> bool {
    match_word_sequence(hay, words, TrailingBoundary::WordBoundary)
}

/// `\b w0 \s+ w1 \s+ ... wN \s+` — same, but requiring trailing whitespace
/// instead of a bare boundary (the `/\bgh\s+pr\s+/` prefix probe).
pub(super) fn has_word_sequence_trailing_ws(hay: &str, words: &[&str]) -> bool {
    match_word_sequence(hay, words, TrailingBoundary::RequireWhitespace)
}

enum TrailingBoundary {
    WordBoundary,
    RequireWhitespace,
}

fn match_word_sequence(hay: &str, words: &[&str], trailing: TrailingBoundary) -> bool {
    if words.is_empty() {
        return false;
    }
    let chars: Vec<char> = hay.chars().collect();
    let n = chars.len();
    'outer: for start in 0..=n {
        // `\b` before the first (word-char-initial) token: prev must be non-word.
        if start > 0 && is_word_char(chars[start - 1]) {
            continue;
        }
        let mut i = start;
        for (wi, w) in words.iter().enumerate() {
            if wi > 0 {
                // `\s+` between tokens — at least one whitespace char.
                let ws_start = i;
                while i < n && chars[i].is_whitespace() {
                    i += 1;
                }
                if i == ws_start {
                    continue 'outer;
                }
            }
            for wc in w.chars() {
                if i >= n || chars[i] != wc {
                    continue 'outer;
                }
                i += 1;
            }
        }
        match trailing {
            TrailingBoundary::WordBoundary => {
                if i < n && is_word_char(chars[i]) {
                    continue;
                }
            }
            TrailingBoundary::RequireWhitespace => {
                if i >= n || !chars[i].is_whitespace() {
                    continue;
                }
            }
        }
        return true;
    }
    false
}

/// Try to match `f` at each occurrence of `prefix` in `text` (regex left-to-right
/// scan); return the first full match.
pub(super) fn scan_prefix(
    text: &str,
    prefix: &str,
    f: impl Fn(&str) -> Option<DetectedPrCore>,
) -> Option<DetectedPrCore> {
    let mut from = 0;
    while let Some(rel) = text[from..].find(prefix) {
        let occ = from + rel;
        if let Some(pr) = f(&text[occ + prefix.len()..]) {
            return Some(pr);
        }
        from = occ + 1;
    }
    None
}
