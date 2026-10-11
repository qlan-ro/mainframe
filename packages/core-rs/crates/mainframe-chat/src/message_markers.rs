//! Parses message blocks used by the composer but hidden from the reader.
//!
//! The daemon only needs the *fenced* ones, and only to title a chat: a session
//! title must read like the message did, not like the composer's plumbing. Both
//! title paths (deterministic fallback and LLM) run [`visible_message_text`].
//!
//! Whole-message forms (the review-comment card, the plan preamble) never reach a
//! title path, so they are excluded here — except the agent-message marker,
//! which is a chat's first message when an agent launches it. New fenced markers
//! in the UI parser also need handling here or they surface verbatim
//! in the sidebar.
//!
//! The `regex` crate is not a dependency of this crate; both matchers are
//! hand-rolled against the UI's patterns.

// ── Sandbox captures ────────────────────────────────────────────────────────

const SANDBOX_CAPTURE_SENTINEL: &str = "\0__MF_SANDBOX_CAPTURE__";
const CAPTURE_HEADER_LINE: &str = "> **Preview captures**";

/// `CAPTURE_ROW_RE`: ``> - `label` — selector `sel` — "annotation"``, the last two
/// optional. Anchored at both ends, like the UI's regex.
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
pub(crate) fn strip_sandbox_capture_block(text: &str) -> String {
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

// ── Session references ──────────────────────────────────────────────────────

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
/// preceded by a blank line) plus one adjacent blank line.
pub(crate) fn strip_reference_lines(text: &str) -> String {
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
pub(crate) fn visible_message_text(text: &str) -> String {
    strip_sandbox_capture_block(&strip_reference_lines(&unwrap_agent_message(text)))
}

// ── Agent messages ──────────────────────────────────────────────────────────

const AGENT_MESSAGE_OPEN: &str = "<mainframe-agent-message ";
const AGENT_MESSAGE_CLOSE: &str = "</mainframe-agent-message>";

/// The body of a whole-message agent marker (`chat_launch` and `chat_send`
/// prompts from the orchestration MCP server), so a chat an agent launched is
/// titled after the prompt, not the marker. Anything else passes through
/// unchanged.
pub(crate) fn unwrap_agent_message(text: &str) -> String {
    let trimmed = text.trim();
    let Some(rest) = trimmed.strip_prefix(AGENT_MESSAGE_OPEN) else {
        return text.to_string();
    };
    let (Some(header_end), true) = (rest.find('>'), rest.ends_with(AGENT_MESSAGE_CLOSE)) else {
        return text.to_string();
    };
    let body = &rest[header_end + 1..rest.len() - AGENT_MESSAGE_CLOSE.len()];
    body.trim().to_string()
}

#[cfg(test)]
#[path = "message_markers_tests.rs"]
mod tests;
