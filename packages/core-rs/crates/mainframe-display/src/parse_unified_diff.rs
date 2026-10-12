//! Adapter-agnostic: parses a unified-diff string into `DiffHunk`s. The hunk
//! header grammar is hand-rolled — the display crate carries no regex
//! dependency and the grammar is fixed.

use mainframe_types::chat::DiffHunk;

/// Parses a unified-diff string into an array of `DiffHunk` objects.
///
/// Each `@@ -<oldStart>[,<oldLines>] +<newStart>[,<newLines>] @@` header starts a
/// new hunk. Lines following a header (until the next header or EOF) are the
/// hunk's `lines`, with their leading `+`/`-`/` ` character preserved.
///
/// If the input contains no hunk headers (e.g. a bare `+foo\n-bar`), all lines
/// are collected into a single hunk with `oldStart=1, newStart=1`.
pub fn parse_unified_diff(diff: &str) -> Vec<DiffHunk> {
    if diff.trim().is_empty() {
        return Vec::new();
    }

    let mut hunks: Vec<DiffHunk> = Vec::new();
    let mut current: Option<DiffHunk> = None;

    for line in diff.split('\n') {
        if let Some((old_start, old_lines, new_start, new_lines)) = parse_hunk_header(line) {
            if let Some(hunk) = current.take() {
                hunks.push(hunk);
            }
            current = Some(DiffHunk {
                old_start,
                old_lines,
                new_start,
                new_lines,
                lines: Vec::new(),
            });
        } else if let Some(hunk) = current.as_mut() {
            hunk.lines.push(line.to_string());
        } else {
            // Headerless diff — lazily create a default hunk on first content line.
            current = Some(DiffHunk {
                old_start: 1,
                old_lines: 0,
                new_start: 1,
                new_lines: 0,
                lines: vec![line.to_string()],
            });
        }
    }

    if let Some(hunk) = current.take() {
        hunks.push(hunk);
    }

    hunks
}

/// Matches `^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@`.
/// Absent `,<lines>` groups default to `1`. The
/// regex is not end-anchored, so trailing section text after ` @@` is ignored.
fn parse_hunk_header(line: &str) -> Option<(i64, i64, i64, i64)> {
    let rest = line.strip_prefix("@@ -")?;
    let (old_start, rest) = take_number(rest)?;
    let (old_lines, rest) = take_optional_count(rest)?;
    let rest = rest.strip_prefix(" +")?;
    let (new_start, rest) = take_number(rest)?;
    let (new_lines, rest) = take_optional_count(rest)?;
    rest.strip_prefix(" @@")?;
    Some((old_start, old_lines, new_start, new_lines))
}

/// `(?:,(\d+))?` — an optional `,<digits>` group; defaults to `1` when absent.
fn take_optional_count(s: &str) -> Option<(i64, &str)> {
    if let Some(after_comma) = s.strip_prefix(',') {
        take_number(after_comma)
    } else {
        Some((1, s))
    }
}

/// Consumes a leading run of ASCII decimal digits.
fn take_number(s: &str) -> Option<(i64, &str)> {
    let end = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    if end == 0 {
        return None;
    }
    let value = s[..end].parse::<i64>().ok()?;
    Some((value, &s[end..]))
}

#[cfg(test)]
#[path = "parse_unified_diff_tests.rs"]
mod tests;
