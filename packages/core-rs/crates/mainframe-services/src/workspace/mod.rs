//! Workspace paths, worktrees, and project helpers.

pub mod session_files;
pub mod worktree;

pub use session_files::{get_claude_project_dir, move_session_files};
pub use worktree::{
    WorktreeEntry, WorktreeInfo, add_worktree_for_branch, branch_exists,
    compute_worktree_parent_links, create_worktree, get_worktrees, is_worktree_present,
    parse_worktree_list, remove_worktree, short_branch,
};
