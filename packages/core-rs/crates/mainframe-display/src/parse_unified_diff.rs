//! Ported from `packages/core/src/messages/parse-unified-diff.ts`.
//!
//! Adapter-agnostic: parses a unified-diff string into `DiffHunk`s (§2.5 display
//! side). The TS `HUNK_HEADER_RE` regex is hand-rolled here — the display crate
//! carries no regex dependency and the header grammar is fixed.

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

/// Matches `^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@` — the TS `HUNK_HEADER_RE`.
/// Absent `,<lines>` groups default to `1` (matching `parseInt(...) : 1`). The
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

/// Consumes a leading run of ASCII digits, mirroring `\d+` + `parseInt(_, 10)`.
fn take_number(s: &str) -> Option<(i64, &str)> {
    let end = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    if end == 0 {
        return None;
    }
    let value = s[..end].parse::<i64>().ok()?;
    Some((value, &s[end..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_or_whitespace_returns_no_hunks() {
        assert!(parse_unified_diff("").is_empty());
        assert!(parse_unified_diff("   \n  ").is_empty());
    }

    #[test]
    fn headerless_diff_collapses_into_a_single_default_hunk() {
        let hunks = parse_unified_diff("+foo\n-bar");
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_start, 1);
        assert_eq!(hunks[0].old_lines, 0);
        assert_eq!(hunks[0].new_start, 1);
        assert_eq!(hunks[0].new_lines, 0);
        assert_eq!(hunks[0].lines, vec!["+foo".to_string(), "-bar".to_string()]);
    }

    #[test]
    fn single_header_with_counts() {
        let hunks = parse_unified_diff("@@ -1,3 +2,4 @@\n context\n+added");
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_start, 1);
        assert_eq!(hunks[0].old_lines, 3);
        assert_eq!(hunks[0].new_start, 2);
        assert_eq!(hunks[0].new_lines, 4);
        assert_eq!(
            hunks[0].lines,
            vec![" context".to_string(), "+added".to_string()]
        );
    }

    #[test]
    fn header_without_comma_counts_defaults_to_one() {
        let hunks = parse_unified_diff("@@ -5 +6 @@\n-x");
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_start, 5);
        assert_eq!(hunks[0].old_lines, 1);
        assert_eq!(hunks[0].new_start, 6);
        assert_eq!(hunks[0].new_lines, 1);
        assert_eq!(hunks[0].lines, vec!["-x".to_string()]);
    }

    #[test]
    fn trailing_section_text_after_header_is_ignored() {
        let hunks = parse_unified_diff("@@ -1,1 +1,1 @@ fn foo() {\n-a\n+b");
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_start, 1);
        assert_eq!(hunks[0].lines, vec!["-a".to_string(), "+b".to_string()]);
    }

    #[test]
    fn multiple_headers_produce_multiple_hunks() {
        let hunks = parse_unified_diff("@@ -1,1 +1,1 @@\n-a\n@@ -10,2 +10,3 @@\n+b\n+c");
        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0].old_start, 1);
        assert_eq!(hunks[0].lines, vec!["-a".to_string()]);
        assert_eq!(hunks[1].old_start, 10);
        assert_eq!(hunks[1].old_lines, 2);
        assert_eq!(hunks[1].new_lines, 3);
        assert_eq!(hunks[1].lines, vec!["+b".to_string(), "+c".to_string()]);
    }
}

// PORT STATUS: src/messages/parse-unified-diff.ts (46 lines)
// confidence: high
// todos: 0
// notes: §2.5 display side (pure parser over DiffHunk from mainframe-types::chat).
// notes: HUNK_HEADER_RE is hand-rolled (no regex dep in the display crate) —
// notes: same grammar, same defaults (absent count → 1), same non-end-anchored
// notes: match (trailing section text ignored). Headerless default hunk keeps
// notes: oldLines/newLines = 0 exactly as the TS lazy branch does. Tests derived
// notes: from the TS doc contract (TS had no sibling test file).
