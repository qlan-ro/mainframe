//! Ported from `packages/core/src/chat/title-generator.ts`.
//!
//! Callers must hand these functions [`crate::message_markers::visible_message_text`]
//! output, not a raw wire body — a title has to read like the message did.

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

/// Which CLI generates the title for `adapter_id`. The `provider.<adapterId>.titleBinary`
/// setting wins; otherwise each adapter titles with its own binary. It used to fall back
/// to `claude` for every adapter, which asked a Codex-only user's machine to shell out to
/// a CLI it may not have installed (#275).
pub fn resolve_title_binary(setting: Option<String>, adapter_id: &str) -> String {
    setting
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| adapter_id.to_string())
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
    fn title_binary_defaults_to_the_chats_own_adapter() {
        assert_eq!(resolve_title_binary(None, "codex"), "codex");
        assert_eq!(resolve_title_binary(None, "claude"), "claude");
    }

    #[test]
    fn title_binary_setting_wins_when_non_empty() {
        assert_eq!(
            resolve_title_binary(Some("/custom/bin".to_string()), "codex"),
            "/custom/bin"
        );
        assert_eq!(resolve_title_binary(Some(String::new()), "codex"), "codex");
    }

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
