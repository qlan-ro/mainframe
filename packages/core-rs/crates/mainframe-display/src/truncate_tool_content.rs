//! Ported from `packages/core/src/messages/truncate-tool-content.ts`.
//!
//! Adapter-agnostic: truncates an oversized tool-result string for display. No
//! Claude event/JSONL shapes (§2.5 display side).

pub const TRUNCATE_THRESHOLD_BYTES: usize = 32 * 1024;
const HEAD_LINES: usize = 100;
const TAIL_LINES: usize = 100;

#[derive(Debug, Clone, PartialEq)]
pub struct TruncateResult {
    pub content: String,
    pub truncated: bool,
    pub full_bytes: Option<i64>,
}

pub fn truncate_tool_content(content: &str) -> TruncateResult {
    let full_bytes = content.len();
    if full_bytes <= TRUNCATE_THRESHOLD_BYTES {
        return TruncateResult {
            content: content.to_string(),
            truncated: false,
            full_bytes: None,
        };
    }

    let lines: Vec<&str> = content.split('\n').collect();
    // Round to whole KB the same way JS `Math.round` does (half away from zero,
    // which matches Math.round for the non-negative byte counts here).
    let kb = ((full_bytes as f64) / 1024.0).round() as i64;

    if lines.len() <= HEAD_LINES + TAIL_LINES {
        // Very long single/few-line content: slice by UTF-16 code units so the
        // head/tail boundaries match JS `String.prototype.slice`.
        let half = TRUNCATE_THRESHOLD_BYTES / 2;
        let head = slice_utf16_prefix(content, half);
        let tail = slice_utf16_suffix(content, half);
        return TruncateResult {
            content: format!("{head}\n…[truncated · {kb} KB — expand]…\n{tail}"),
            truncated: true,
            full_bytes: Some(full_bytes as i64),
        };
    }

    let head = lines[..HEAD_LINES].join("\n");
    let tail = lines[lines.len() - TAIL_LINES..].join("\n");
    let omitted = lines.len() - HEAD_LINES - TAIL_LINES;
    TruncateResult {
        content: format!("{head}\n…[truncated {omitted} lines · {kb} KB — expand]…\n{tail}"),
        truncated: true,
        full_bytes: Some(full_bytes as i64),
    }
}

/// Mirrors JS `content.slice(0, n)` where `n` counts UTF-16 code units.
fn slice_utf16_prefix(content: &str, n: usize) -> String {
    let units: Vec<u16> = content.encode_utf16().collect();
    let end = n.min(units.len());
    String::from_utf16_lossy(&units[..end])
}

/// Mirrors JS `content.slice(-n)` where `n` counts UTF-16 code units.
fn slice_utf16_suffix(content: &str, n: usize) -> String {
    let units: Vec<u16> = content.encode_utf16().collect();
    let start = units.len().saturating_sub(n);
    String::from_utf16_lossy(&units[start..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_content_unchanged_below_threshold_no_flag() {
        let small = "line\n".repeat(10);
        let r = truncate_tool_content(&small);
        assert!(!r.truncated);
        assert_eq!(r.content, small);
        assert_eq!(r.full_bytes, None);
    }

    #[test]
    fn truncates_above_threshold_to_head_100_marker_tail_100() {
        let big = (0..5000)
            .map(|i| format!("row {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(big.len() > TRUNCATE_THRESHOLD_BYTES);
        let r = truncate_tool_content(&big);
        assert!(r.truncated);
        assert_eq!(r.full_bytes, Some(big.len() as i64));
        let lines: Vec<&str> = r.content.split('\n').collect();
        assert_eq!(lines[0], "row 0");
        assert_eq!(lines[99], "row 99");
        assert!(r.content.contains("truncated"));
        assert_eq!(lines[lines.len() - 1], "row 4999");
        assert_eq!(lines[lines.len() - 100], "row 4900");
    }

    #[test]
    fn treats_a_string_just_over_the_byte_threshold_as_truncated() {
        let just_over = "x".repeat(TRUNCATE_THRESHOLD_BYTES + 1);
        assert!(truncate_tool_content(&just_over).truncated);
    }

    #[test]
    fn treats_a_string_exactly_at_the_threshold_as_untruncated() {
        let exact = "x".repeat(TRUNCATE_THRESHOLD_BYTES);
        assert!(!truncate_tool_content(&exact).truncated);
    }
}

// PORT STATUS: src/messages/truncate-tool-content.ts (34 lines)
// confidence: high
// todos: 0
// notes: §2.5 display side (pure string helper). `Buffer.byteLength(content,'utf8')`
// notes: → `str::len()` (UTF-8 bytes). The few-lines branch mirrors JS
// notes: `String.slice(0,n)`/`slice(-n)` which count UTF-16 code units, so it
// notes: slices via encode_utf16 + from_utf16_lossy (a slice boundary landing mid
// notes: surrogate-pair yields U+FFFD; V8 would emit a lone surrogate — an
// notes: astral-plane-at-16384-boundary edge only). Marker literals (…, ·, —)
// notes: copied verbatim. All four truncate-tool-content.test.ts cases ported.
