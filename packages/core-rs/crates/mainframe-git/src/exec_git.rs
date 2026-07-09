//! Ported from `packages/core/src/server/routes/exec-git.ts`.
//!
//! That file is a byte-near-duplicate of `git/git-exec.ts` (same `execGit`
//! signature and semantics — `worktree.ts` imported this copy, `git-service.ts`
//! the other). Per the project's single-canonical-type rule the two collapse to
//! one implementation; this module re-exports it so the crate map's `exec_git`
//! target resolves without duplicating logic.

pub use crate::git_exec::{GitExecCode, GitExecError, GitExecOptions, exec_git};

// PORT STATUS: packages/core/src/server/routes/exec-git.ts (25 lines)
// confidence: high
// notes: Re-export of `git_exec::exec_git` — the routes copy is a duplicate of
// `git/git-exec.ts`, collapsed to one impl per the single-canonical rule. No
// distinct logic to port.
