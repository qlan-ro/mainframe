//! Workspace validation for agent-launched chats. Worktrees live outside the
//! project root, so `resolveAndValidatePath` cannot apply; instead a path
//! must be one `git worktree list` reports for the project, and branch
//! names pass the same rule the worktree routes use.

use std::path::PathBuf;

use mainframe_git::exec_git;
use mainframe_orchestration::errors::{ErrorCode, PortError, ToolError};
use mainframe_services::workspace::{get_worktrees, short_branch};

/// A conservative branch-name rule (letters, digits, `. _ / -`, no `..`,
/// alphanumeric first), shared with `routes/worktree.rs`.
pub(crate) fn branch_name_ok(name: &str) -> bool {
    if name.is_empty() || name.contains("..") {
        return false;
    }
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '/' | '-'))
}

pub(super) fn invalid(message: impl Into<String>) -> PortError {
    PortError::Public(ToolError::new(ErrorCode::WorkspaceInvalid, message))
}

/// `new_worktree`: both names valid and the base branch present.
pub(super) async fn check_new_worktree(
    project_path: &str,
    base_branch: &str,
    branch_name: &str,
) -> Result<(), PortError> {
    if !branch_name_ok(branch_name) {
        return Err(invalid(format!("Invalid branch name: {branch_name}")));
    }
    if !branch_name_ok(base_branch) {
        return Err(invalid(format!("Invalid base branch: {base_branch}")));
    }
    let args = vec![
        "rev-parse".to_string(),
        "--verify".to_string(),
        "--quiet".to_string(),
        format!("{base_branch}^{{commit}}"),
    ];
    exec_git(&args, project_path, None)
        .await
        .map(|_| ())
        .map_err(|_| invalid(format!("Base branch {base_branch} does not exist")))
}

/// `existing_worktree`: the canonical path must be one of the project's
/// worktrees. Returns the canonical path and its branch, if any.
pub(super) async fn check_existing_worktree(
    project_path: &str,
    requested: &str,
) -> Result<(String, Option<String>), PortError> {
    let not_a_worktree = || invalid("The path is not a worktree of this project");
    let wanted = tokio::fs::canonicalize(requested)
        .await
        .map_err(|_| not_a_worktree())?;
    for entry in get_worktrees(project_path).await {
        let listed = tokio::fs::canonicalize(&entry.path)
            .await
            .unwrap_or_else(|_| PathBuf::from(&entry.path));
        if listed == wanted {
            let branch = entry.branch.as_deref().map(|b| short_branch(b).to_string());
            return Ok((wanted.to_string_lossy().into_owned(), branch));
        }
    }
    Err(not_a_worktree())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn branch_names_follow_the_worktree_route_rule() {
        assert!(branch_name_ok("feat/mcp-server"));
        assert!(!branch_name_ok("-x"));
        assert!(!branch_name_ok("a..b"));
        assert!(!branch_name_ok("a b"));
    }
}
