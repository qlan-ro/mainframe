//! Ported from `packages/core/src/background-tasks/encoding.ts`.

/// Encode an absolute path into the Claude CLI spool `cwdSeg` form: every `/`
/// and `.` becomes `-`. Mirrors the TS `absPath.replace(/[/.]/g, '-')`.
pub fn encode_cwd_segment(abs_path: &str) -> String {
    abs_path
        .chars()
        .map(|c| if c == '/' || c == '.' { '-' } else { c })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_leading_slash_as_dash_slashes_as_dash() {
        assert_eq!(
            encode_cwd_segment("/Users/x/Projects/qlan/mainframe"),
            "-Users-x-Projects-qlan-mainframe"
        );
    }

    #[test]
    fn encodes_dots_as_dash_producing_double_dash_for_slash_dot_transitions() {
        assert_eq!(
            encode_cwd_segment("/Users/x/Projects/qlan/mainframe/.worktrees/feat-bg-tasks"),
            "-Users-x-Projects-qlan-mainframe--worktrees-feat-bg-tasks"
        );
    }

    #[test]
    fn preserves_hyphens() {
        assert_eq!(
            encode_cwd_segment("/Users/x/feat-bg-tasks"),
            "-Users-x-feat-bg-tasks"
        );
    }

    #[test]
    fn preserves_underscores() {
        assert_eq!(
            encode_cwd_segment("/Users/x/Projects/blueprint/DBricks_Optimizer"),
            "-Users-x-Projects-blueprint-DBricks_Optimizer"
        );
    }
}

// PORT STATUS: src/background-tasks/encoding.ts (3 lines)
// confidence: high
// todos: 0
// notes: regex /[/.]/g char-replace; no regex crate needed. Tests translated
// assertion-for-assertion from encoding.test.ts.
