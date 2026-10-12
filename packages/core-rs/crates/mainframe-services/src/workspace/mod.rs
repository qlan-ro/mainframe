//! Workspace paths, worktrees, and project helpers.

pub use mainframe_git::git_parse::{WorktreeEntry, parse_worktree_list};
pub mod worktree;

pub use worktree::{
    WorktreeInfo, add_worktree_for_branch, branch_exists, compute_worktree_parent_links,
    create_worktree, get_worktrees, is_worktree_present, remove_worktree, short_branch,
};

mod scope;
pub use scope::{ScopeError, ScopePath, check_scope_presence, resolve_scope};
