//! Rule 6 (todo #346) — the single resolver every cwd consumer uses to derive
//! a chat's working directory.
//!
//! A chat's cwd is, in priority order: its worktree path, its non-project
//! scratch path (`<data_dir>/scratch/<chatId>`), then its project's path.
//! `project_path` is `None` exactly when the project cannot be resolved —
//! which is always true for the hidden `NO_PROJECT_ID` scratch row (rule 1) —
//! so a non-project chat with no worktree still resolves to its scratch path
//! instead of failing.

/// `worktree_path ?? scratch_path ?? project_path`. `None` means no consumer
/// can derive a cwd for this chat (an orphaned project reference with no
/// worktree and no scratch path).
pub fn chat_cwd(
    worktree_path: Option<&str>,
    scratch_path: Option<&str>,
    project_path: Option<String>,
) -> Option<String> {
    worktree_path
        .map(str::to_string)
        .or_else(|| scratch_path.map(str::to_string))
        .or(project_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_the_worktree_path_over_everything_else() {
        assert_eq!(
            chat_cwd(
                Some("/wt/x"),
                Some("/data/scratch/c1"),
                Some("/proj".to_string())
            ),
            Some("/wt/x".to_string())
        );
    }

    #[test]
    fn falls_back_to_the_scratch_path_with_no_worktree() {
        assert_eq!(
            chat_cwd(None, Some("/data/scratch/c1"), Some("/proj".to_string())),
            Some("/data/scratch/c1".to_string())
        );
    }

    #[test]
    fn falls_back_to_the_scratch_path_even_with_no_resolvable_project() {
        // The hidden NO_PROJECT_ID row never resolves via `projects_get_path`
        // (rule 1); the scratch path must still win over a `None` project.
        assert_eq!(
            chat_cwd(None, Some("/data/scratch/c1"), None),
            Some("/data/scratch/c1".to_string())
        );
    }

    #[test]
    fn falls_back_to_the_project_path_with_neither_worktree_nor_scratch() {
        assert_eq!(
            chat_cwd(None, None, Some("/proj".to_string())),
            Some("/proj".to_string())
        );
    }

    #[test]
    fn none_when_nothing_resolves() {
        assert_eq!(chat_cwd(None, None, None), None);
    }
}

// PORT STATUS: NEW module (todo #346, G2b)
// confidence: high
// todos: 0
// notes: pure rule-6 resolver, parameterized on the three raw fields so both
// notes: full-`Chat` consumers (lifecycle_manager, transcript_presence) and the
// notes: partial-field consumer (event_handler's `on_init`, which only holds
// notes: destructured fields under its active-chat lock) share one function.
