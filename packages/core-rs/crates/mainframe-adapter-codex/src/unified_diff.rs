//! Moved out of `history.rs` (task 2, todo #247) to keep that file under the
//! 300-line ceiling. `parse_unified_diff` and its two helpers, unchanged.

use mainframe_types::chat::DiffHunk;

/// TODO(port): replace with `mainframe_display::parse_unified_diff::parse_unified_diff`
/// once that (currently-skeleton) module is ported by the mainframe-display task.
/// Faithful copy of `messages/parse-unified-diff.ts` kept crate-private meanwhile so
/// this crate compiles + tests green (BLOCKER surfaced in the task output).
pub(crate) fn parse_unified_diff(diff: &str) -> Vec<DiffHunk> {
    if diff.trim().is_empty() {
        return Vec::new();
    }
    let mut hunks: Vec<DiffHunk> = Vec::new();
    let mut current: Option<DiffHunk> = None;
    for line in diff.split('\n') {
        if let Some(hdr) = parse_hunk_header(line) {
            if let Some(c) = current.take() {
                hunks.push(c);
            }
            current = Some(hdr);
        } else if let Some(c) = current.as_mut() {
            c.lines.push(line.to_string());
        } else {
            current = Some(DiffHunk {
                old_start: 1,
                old_lines: 0,
                new_start: 1,
                new_lines: 0,
                lines: vec![line.to_string()],
            });
        }
    }
    if let Some(c) = current {
        hunks.push(c);
    }
    hunks
}

/// `^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@` — hand-rolled (no regex crate).
fn parse_hunk_header(line: &str) -> Option<DiffHunk> {
    let rest = line.strip_prefix("@@ -")?;
    let (old, rest) = rest.split_once(" +")?;
    // trailing " @@..." — take up to " @@"
    let (new, _) = rest.split_once(" @@")?;
    let (old_start, old_lines) = parse_pair(old)?;
    let (new_start, new_lines) = parse_pair(new)?;
    Some(DiffHunk {
        old_start,
        old_lines,
        new_start,
        new_lines,
        lines: Vec::new(),
    })
}

/// `<start>[,<lines>]` → `(start, lines)` (lines defaults to 1 when absent).
fn parse_pair(s: &str) -> Option<(i64, i64)> {
    match s.split_once(',') {
        Some((a, b)) => Some((a.parse().ok()?, b.parse().ok()?)),
        None => Some((s.parse().ok()?, 1)),
    }
}
