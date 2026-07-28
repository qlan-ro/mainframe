//! Ported from `packages/core/src/chat/title-generator.ts`.

/// Ported from `packages/ui/src/features/chat/session-references/reference-line.ts`'s
/// `stripReferenceLines`. Titling must see what the reader sees, not the raw
/// `Referenced session @session[...]: <path>` lines the composer prepends to the
/// wire body (#240) — this is applied to the message before either title path
/// (deterministic fallback or LLM) runs.
fn is_reference_line(line: &str) -> bool {
    const PREFIX: &str = "Referenced session @session[";
    let Some(rest) = line.strip_prefix(PREFIX) else {
        return false;
    };
    let Some(bracket_end) = rest.find(']') else {
        return false;
    };
    let Some(path_part) = rest[bracket_end + 1..].strip_prefix(": ") else {
        return false;
    };
    !path_part.starts_with(char::is_whitespace) && !path_part.is_empty()
}

/// Strips every block-initial run of reference lines (a run starting at line 0 or
/// preceded by a blank line) plus one adjacent blank line, mirroring the TS
/// `stripReferenceLines` byte-for-byte.
pub fn strip_reference_lines(text: &str) -> String {
    let source: Vec<&str> = text.split('\n').collect();
    let mut kept: Vec<&str> = Vec::new();
    let mut changed = false;
    let mut i = 0;

    while i < source.len() {
        let block_initial = i == 0 || source[i - 1].is_empty();
        if block_initial && is_reference_line(source[i]) {
            let mut end = i;
            while end < source.len() && is_reference_line(source[end]) {
                end += 1;
            }
            changed = true;
            if end < source.len() && source[end].is_empty() {
                end += 1;
            } else if kept.last().is_some_and(|s| s.is_empty()) {
                kept.pop();
            }
            i = end;
            continue;
        }
        kept.push(source[i]);
        i += 1;
    }

    if changed {
        kept.join("\n")
    } else {
        text.to_string()
    }
}

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

    #[test]
    fn strips_a_leading_run_of_reference_lines_plus_the_following_blank_line() {
        let text = "Referenced session @session[Foo]: /tmp/foo.jsonl\n\
Referenced session @session[Bar]: /tmp/bar.jsonl\n\n\
look at this";
        assert_eq!(strip_reference_lines(text), "look at this");
    }

    #[test]
    fn strips_a_reference_run_that_starts_a_later_block() {
        let text = "/review\n\nReferenced session @session[Foo]: /tmp/foo.jsonl\n\nrest";
        assert_eq!(strip_reference_lines(text), "/review\n\nrest");
    }

    #[test]
    fn leaves_a_reference_shaped_line_alone_when_preceded_by_a_non_empty_line() {
        let text = "some prose\nReferenced session @session[Foo]: /tmp/foo.jsonl\nmore prose";
        assert_eq!(strip_reference_lines(text), text);
    }

    #[test]
    fn is_a_no_op_for_text_with_no_reference_lines() {
        let text = "just a plain message with @session[Foo] inline";
        assert_eq!(strip_reference_lines(text), text);
    }

    #[test]
    fn returns_an_empty_string_for_text_that_is_only_reference_lines() {
        let text = "Referenced session @session[Foo]: /tmp/foo.jsonl\n\
Referenced session @session[Bar]: /tmp/bar.jsonl";
        assert_eq!(strip_reference_lines(text), "");
    }

    #[test]
    fn round_trips_a_single_line_slash_body_byte_identically() {
        let prepended = "/review @session[Foo]\n\nReferenced session @session[Foo]: /tmp/foo.jsonl";
        assert_eq!(strip_reference_lines(prepended), "/review @session[Foo]");
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
