//! `mainframe-adapter-codex` — the Codex CLI integration (app-server JSON-RPC).
//!
//! This crate owns the Codex JSON-RPC framing, `turn/start` config, approval
//! handling, and rollout-reader history formats. The daemon boot registers
//! `CodexAdapter` directly.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod adapter;
pub mod agent_message_partial;
pub mod approval_handler;
pub(crate) mod collab_activity;
pub(crate) mod collab_card;
pub(crate) mod collab_identity;
pub(crate) mod collab_protocol;
pub(crate) mod collab_resolve;
mod command_metadata;
mod command_state;
pub(crate) mod compaction;
pub mod context_files;
pub(crate) mod context_window;
mod effective_model;
pub mod event_mapper;
pub mod external_session_parse;
pub mod external_sessions;
pub(crate) mod fork;
pub(crate) mod fork_pin;
pub mod history;
pub(crate) mod history_collab;
pub(crate) mod history_collab_resolve;
pub(crate) mod history_convert;
pub(crate) mod history_load;
pub(crate) mod image_generation_history;
pub(crate) mod image_generation_render;
pub mod item_types;
pub mod jsonrpc;
pub(crate) mod orchestration_args;
pub(crate) mod parent_id_sink;
pub mod plan_mode_handler;
pub mod quota_identity;
pub mod quota_pull;
pub mod quota_rate_limit;
pub mod read_tool_result_from_rollout;
pub(crate) mod rollout_apply_patch;
pub(crate) mod rollout_fork;
pub mod rollout_reader;
pub(crate) mod rollout_reconstruct;
pub(crate) mod rollout_unified_exec;
pub mod session;
pub(crate) mod session_state;
pub mod skills;
pub(crate) mod thread_item_render;
pub(crate) mod thread_item_variants;
pub mod thread_registry;
mod thread_request;
pub mod title_generator;
pub mod transcript;
pub mod turn_config;
pub(crate) mod turn_lifecycle;
pub(crate) mod turn_model;
pub mod types;
pub(crate) mod unified_diff;
pub(crate) mod user_input;
pub(crate) mod web_search_action;
pub(crate) mod web_search_history;
pub(crate) mod web_search_render;

pub use adapter::{CodexAdapter, map_codex_model};
pub use external_sessions::{clear_codex_external_session_cache, list_external_sessions};
pub use plan_mode_handler::CodexPlanModeHandler;
pub use quota_identity::{CODEX_IDENTITY_TRANSIENT, read_codex_account_identity_from_disk};
pub use session::{CodexScanDeps, CodexSession};

mod notification_types;
mod presentation_fields;
mod presentation_history;
#[cfg(test)]
mod presentation_history_tests;
mod presentation_sink;
#[cfg(test)]
mod rollout_profile_test;
mod thread_read_types;
mod transcript_presentation;
