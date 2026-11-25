//! Workspace paths, worktrees, and project helpers.

pub use mainframe_git::git_parse::{WorktreeEntry, parse_worktree_list};
mod branch_ref;
pub mod worktree;
pub use branch_ref::is_branch_start_point;

pub use worktree::{
    WorktreeInfo, add_worktree_for_branch, branch_exists, checkout_worktree,
    compute_worktree_parent_links, create_worktree, find_branch_worktree, get_worktrees,
    is_worktree_present, remove_worktree, short_branch,
};

mod scope;
pub use scope::{ScopeError, ScopePath, check_scope_presence, resolve_scope};
