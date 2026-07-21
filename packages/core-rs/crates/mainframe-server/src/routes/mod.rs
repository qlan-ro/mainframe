//! Ported from `src/server/routes/*` — one module per TS route file.
//!
//! Each Phase-3 route module exposes `pub fn router() -> Router<Arc<AppCtx>>`.
//! The 12 route modules below are EMPTY stubs in Task 3.1; the route agents fill
//! their handlers. `http.rs` mounts them (see the mount table there).

pub mod adapters;
pub mod agents;
pub mod attachments;
pub mod auth;
pub mod automation_admin;
pub mod automation_webhook;
pub mod automations;
#[cfg(test)]
pub(crate) mod automations_test_support;
pub mod background_tasks;
pub mod chat_commands;
pub mod chat_recovery;
pub mod chats;
pub mod commands;
pub mod context;
pub mod device;
pub mod external_sessions;
pub mod files;
pub mod git;
pub mod git_chat;
pub mod git_write;
pub mod health;
pub mod launch;
pub mod lsp_routes;
pub mod projects;
pub mod quota;
pub mod search;
pub mod settings;
pub mod skills;
pub mod tags;
pub mod tunnel;
pub mod worktree;

// PORT STATUS: src/server/routes/index.ts (mount table)
// confidence: high
// todos: 1
// notes: `health` is a live handler (mounted directly in http.rs); the other 12
// are EMPTY `router()` stubs for the Phase-3 route agents. Phase 4/5 route files
// (chats, chat-commands, context, worktree, external-sessions, background-tasks,
// adapters, agents, skills, lsp-routes, tunnel, workflows, workflow-admin,
// suggestions, launch) are intentionally absent — added when those phases land.
