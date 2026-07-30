//! Mirror of `packages/ui/src/features/chat/markers/message-markers.ts` — the
//! blocks a message body carries for something other than the reader.
//!
//! The daemon only needs the *fenced* ones, and only to title a chat: a session
//! title must read like the message did, not like the composer's plumbing. Both
//! title paths (deterministic fallback and LLM) run [`visible_message_text`].
//!
//! Whole-message forms (the review-comment card, the plan preamble) never reach a
//! title path, so they have no mirror here. Adding a fenced marker on the TS side
//! means adding it here too — otherwise it surfaces verbatim in the sidebar.
//!
//! The `regex` crate is not a dependency of this crate; both matchers are
//! hand-rolled against the TS patterns.

// ── Sandbox captures ────────────────────────────────────────────────────────

const SANDBOX_CAPTURE_SENTINEL: &str = "\0__MF_SANDBOX_CAPTURE__";
const CAPTURE_HEADER_LINE: &str = "> **Preview captures**";

/// `CAPTURE_ROW_RE`: ``> - `label` — selector `sel` — "annotation"``, the last two
/// optional. Anchored at both ends, like the TS regex.
fn is_capture_row(line: &str) -> bool {
    let Some(rest) = line.strip_prefix("> - `") else {
        return false;
    };
    let Some(label_end) = rest.find('`') else {
        return false;
    };
    if label_end == 0 {
        return false; // `[^`]+` needs at least one character
    }
    let mut tail = &rest[label_end + 1..];

    if let Some(after) = tail.strip_prefix(" — selector `") {
        let Some(selector_end) = after.find('`') else {
            return false;
        };
        if selector_end == 0 {
            return false;
        }
        tail = &after[selector_end + 1..];
    }

    match tail.strip_prefix(" — \"") {
        Some(annotation) => annotation.ends_with('"'),
        None => tail.is_empty(),
    }
}

/// Drops the sentinel, the header, and the row run, keeping the user's own text.
/// A malformed line ends the row run and everything from there survives —
/// `parseSandboxCaptureBlock`'s semantics.
pub fn strip_sandbox_capture_block(text: &str) -> String {
    let Some(body) = text.strip_prefix(SANDBOX_CAPTURE_SENTINEL) else {
        return text.to_string();
    };
    let lines: Vec<&str> = body
        .strip_prefix('\n')
        .unwrap_or(body)
        .split('\n')
        .collect();
    let mut i = 0;
    if lines
        .first()
        .is_some_and(|l| l.trim() == CAPTURE_HEADER_LINE)
    {
        i = 1;
    }
    while i < lines.len() && is_capture_row(lines[i]) {
        i += 1;
    }
    lines[i..].join("\n").trim().to_string()
}

// ── Session references (#240) ───────────────────────────────────────────────

/// `SESSION_REFERENCE_LINE_RE`: `Referenced session @session[label]: <path>`.
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

// ── Composition ─────────────────────────────────────────────────────────────

/// What the reader saw: every fenced block stripped. Idempotent. References go
/// first — they sit at offset 0, so removing them is what puts a capture sentinel
/// back at the start of the string where its own strip can find it.
pub fn visible_message_text(text: &str) -> String {
    strip_sandbox_capture_block(&strip_reference_lines(text))
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn strips_the_capture_sentinel_header_and_rows_keeping_the_user_text() {
        let text = "\0__MF_SANDBOX_CAPTURE__\n> **Preview captures**\n\
> - `element1` — selector `nav > .x`\n\
> - `screenshot1` — \"the gap\"\n\nfix the spacing";
        assert_eq!(strip_sandbox_capture_block(text), "fix the spacing");
    }

    #[test]
    fn keeps_a_user_quote_that_follows_the_capture_rows() {
        let text = "\0__MF_SANDBOX_CAPTURE__\n> **Preview captures**\n> - `element1`\n> like this?";
        assert_eq!(strip_sandbox_capture_block(text), "> like this?");
    }

    #[test]
    fn capture_strip_is_a_no_op_without_the_sentinel() {
        let text = "> **Preview captures**\n> - `element1`";
        assert_eq!(strip_sandbox_capture_block(text), text);
    }

    #[test]
    fn visible_text_strips_both_fenced_blocks_from_one_body() {
        let text = "\0__MF_SANDBOX_CAPTURE__\n> **Preview captures**\n> - `element1`\n\n\
Referenced session @session[Foo]: /tmp/foo.jsonl\n\ncompare with @session[Foo]";
        assert_eq!(visible_message_text(text), "compare with @session[Foo]");
    }

    #[test]
    fn visible_text_is_idempotent() {
        let text = "\0__MF_SANDBOX_CAPTURE__\n> **Preview captures**\n> - `element1`\n\nwhy?";
        let once = visible_message_text(text);
        assert_eq!(once, "why?");
        assert_eq!(visible_message_text(&once), once);
    }
}
