//! Ported from `src/server/routes/*` — one module per TS route file.
//!
//! Each Phase-3 route module exposes `pub fn router() -> Router<Arc<AppCtx>>`.
//! The 12 route modules below are EMPTY stubs in Task 3.1; the route agents fill
//! their handlers. `http.rs` mounts them (see the mount table there).

mod adapter_model;
pub mod adapters;
pub mod agent_outbox;
pub mod agents;
pub mod attachments;
pub mod auth;
pub mod automation_admin;
pub mod automation_credentials_github;
pub mod automation_webhook;
pub mod automations;
#[cfg(test)]
pub(crate) mod automations_test_support;
pub mod background_tasks;
pub mod chat_commands;
pub mod chat_create;
pub mod chat_discard;
pub mod chat_fork;
pub mod chat_recovery;
pub mod chat_side_chat;
pub mod chat_switch;
pub mod chat_workflow_runs;
pub mod chats;
pub mod commands;
pub mod context;
pub mod device;
pub mod external_sessions;
pub mod files;
pub mod git;
pub mod git_chat;
pub mod git_remotes;
pub mod git_write;
pub mod health;
mod identifier;
pub mod launch;
pub mod lsp_routes;
pub mod mcp;
pub mod notifications;
pub mod projects;
pub mod quota;
pub mod search;
pub mod session_transcripts;
pub mod settings;
pub mod setup_advisor;
pub mod skills;
pub mod skills_cli;
pub mod skills_registry;
pub mod suggestions;
pub mod tags;
pub mod tunnel;
pub mod tunnel_ports;
pub mod worktree;
pub mod worktree_offer;
