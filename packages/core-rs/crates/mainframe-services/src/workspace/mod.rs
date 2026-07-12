//! Ported from `src/workspace/index.ts` (re-exports).

pub mod session_files;
pub mod worktree;

pub use session_files::{get_claude_project_dir, move_session_files};
pub use worktree::{
    WorktreeEntry, WorktreeInfo, add_worktree_for_branch, backfill_worktree_relationships,
    branch_exists, compute_worktree_parent_links, create_worktree, get_worktrees,
    is_worktree_present, parse_worktree_list, remove_worktree,
};

// PORT STATUS: src/workspace/index.ts (2 lines)
// confidence: high
// todos: 0
// notes: re-export barrel. `backfillWorktreeRelationships` is not re-exported by
// the TS index but is public in worktree.ts; kept public here for its callers.
