//! Ported from `src/workspace/*`, `src/attachment/*`, `src/push/*`,
//! `src/todos/normalize.ts`, `src/commands/*`, `src/notifications/*`,
//! `src/settings/provider-config.ts`, `src/files/file-watcher.ts` (packages/core)
//! — the cross-cutting daemon services (Task 2.4).
//!
//! `src/lib/tag-color.ts` and `src/lib/validate-tag-name.ts` are NOT here: per
//! PORTING.md §2.15 they were relocated into `mainframe-db` (their sole consumer,
//! `tags.rs`) and must not be duplicated.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod attachment;
pub mod commands;
pub mod files;
pub mod notifications;
pub mod push;
pub mod quota;
pub mod settings;
pub mod todos;
pub mod workspace;

// PORT STATUS: crate root for src/{workspace,attachment,push,todos,commands,notifications,settings,files}
// confidence: high
// todos: 0
// notes: lib/tag-color.ts + lib/validate-tag-name.ts landed in mainframe-db (§2.15),
// not here. mainframe-git::exec_git (§2.4) is not yet ported, so workspace::worktree
// carries a local `exec_git` helper marked TODO(port) until the git crate lands.
