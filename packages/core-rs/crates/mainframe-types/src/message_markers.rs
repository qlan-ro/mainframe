// ── Sandbox captures ────────────────────────────────────────────────────────

const SANDBOX_CAPTURE_SENTINEL: &str = "\0__MF_SANDBOX_CAPTURE__";
const CAPTURE_HEADER_LINE: &str = "> **Preview captures**";

/// Drops the sentinel, the header, and the row run, keeping the user's own text.
/// A malformed list row is skipped, matching the UI parser.
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
    while i < lines.len() && lines[i].starts_with("> - ") {
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

pub fn visible_prose_text(text: &str) -> String {
    strip_sandbox_capture_block(&strip_reference_lines(text))
}
