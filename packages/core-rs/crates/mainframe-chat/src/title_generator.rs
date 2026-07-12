//! Ported from `packages/core/src/chat/title-generator.ts`.

/// Deterministic fallback title: the first user message, cleaned and truncated at
/// a word boundary.
pub fn derive_title_from_message(content: &str) -> String {
    let cleaned = collapse_whitespace(content);
    let chars: Vec<char> = cleaned.chars().collect();
    if chars.len() <= 50 {
        return cleaned;
    }
    let truncated = &chars[..50];
    let last_space = truncated.iter().rposition(|c| *c == ' ');
    let head: String = match last_space {
        Some(idx) if idx > 20 => truncated[..idx].iter().collect(),
        _ => truncated.iter().collect(),
    };
    format!("{head}\u{2026}")
}

/// `content.replace(/\s+/g, ' ').trim()` — collapse whitespace runs to a single
/// space and trim.
fn collapse_whitespace(content: &str) -> String {
    let mut out = String::new();
    let mut prev_ws = false;
    for c in content.chars() {
        if c.is_whitespace() {
            if !prev_ws {
                out.push(' ');
                prev_ws = true;
            }
        } else {
            out.push(c);
            prev_ws = false;
        }
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_message_is_returned_verbatim_after_collapse() {
        assert_eq!(
            derive_title_from_message("  Fix   the  bug  "),
            "Fix the bug"
        );
    }

    #[test]
    fn long_message_truncates_at_a_word_boundary_with_ellipsis() {
        let input =
            "Refactor the authentication layer and migrate every provider to the new token flow";
        let out = derive_title_from_message(input);
        assert!(out.ends_with('\u{2026}'));
        assert!(out.chars().count() <= 51);
        assert!(!out.contains("  "));
    }
}

// PORT STATUS: src/chat/title-generator.ts (7 lines)
// confidence: high
// todos: 0
// notes: Main catch-up (#430): `generateTitle` was moved out to the Claude adapter
// notes: (`mainframe-adapter-claude::title_generator::generate_claude_title`); this
// notes: module now keeps only the deterministic `deriveTitleFromMessage` fallback.
// notes: String slicing uses `chars` (Rust scalar) vs TS UTF-16 units — divergence
// notes: only on astral-plane input.
