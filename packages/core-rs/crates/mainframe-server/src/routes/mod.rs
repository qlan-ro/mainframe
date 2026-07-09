//! Ported from `src/server/routes/*` — one module per TS route file.
//!
//! Each Phase-3 route module exposes `pub fn router() -> Router<Arc<AppCtx>>`.
//! The 12 route modules below are EMPTY stubs in Task 3.1; the route agents fill
//! their handlers. `http.rs` mounts them (see the mount table there).

pub mod attachments;
pub mod auth;
pub mod commands;
pub mod device;
pub mod files;
pub mod git;
pub mod git_chat;
pub mod git_write;
pub mod health;
pub mod projects;
pub mod search;
pub mod settings;
pub mod tags;

// PORT STATUS: src/server/routes/index.ts (mount table)
// confidence: high
// todos: 1
// notes: `health` is a live handler (mounted directly in http.rs); the other 12
// are EMPTY `router()` stubs for the Phase-3 route agents. Phase 4/5 route files
// (chats, chat-commands, context, worktree, external-sessions, background-tasks,
// adapters, agents, skills, lsp-routes, tunnel, workflows, workflow-admin,
// suggestions, launch) are intentionally absent — added when those phases land.
