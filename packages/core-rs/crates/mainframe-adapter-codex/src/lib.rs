//! `mainframe-adapter-codex` — the Codex CLI integration (app-server JSON-RPC).
//!
//! Ported from `packages/core/src/plugins/builtin/codex/*` (one `.rs` per `.ts`,
//! crate map §2.8; `index.ts` re-exports collapse into this `lib.rs`). The Codex
//! JSON-RPC framing, `turn/start` config, approval handling, and rollout-reader
//! history formats are copied exactly from the TS source and its tests.
//!
//! The `index.ts` re-exports collapse into this `lib.rs`. `index.ts`'s `activate`
//! (registers the adapter on a `PluginContext`) is deferred until
//! `mainframe-plugins::context` lands — the daemon boot wires `CodexAdapter`
//! directly meanwhile.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod adapter;
pub mod approval_handler;
pub(crate) mod compaction;
pub mod event_mapper;
pub mod external_session_parse;
pub mod external_sessions;
pub mod history;
pub(crate) mod image_generation_render;
pub mod item_types;
pub mod jsonrpc;
pub mod plan_mode_handler;
pub mod quota_identity;
pub mod quota_pull;
pub mod quota_rate_limit;
pub mod rollout_reader;
pub mod session;
pub(crate) mod thread_item_render;
pub(crate) mod thread_item_variants;
pub mod thread_registry;
pub mod transcript;
pub mod turn_config;
pub mod types;

pub use adapter::{CodexAdapter, map_codex_model};
pub use external_sessions::{clear_codex_external_session_cache, list_external_sessions};
pub use plan_mode_handler::CodexPlanModeHandler;
pub use quota_identity::{CODEX_IDENTITY_TRANSIENT, read_codex_account_identity_from_disk};
pub use session::CodexSession;
pub use transcript::is_codex_transcript_present;

// PORT STATUS: src/plugins/builtin/codex/index.ts (8 lines)
// confidence: high
// todos: 1
// notes: index.ts re-exports collapse here. TODO(port): index.ts `activate(ctx)`
// notes: needs mainframe-plugins PluginContext (not yet ported) to call
// notes: ctx.adapters.register + ctx.onUnload(killAll); deferred to that phase.
// notes: quota_rate_limit/quota_identity/quota_pull port the quota harvester
// notes: (quota-rate-limit.ts, quota-identity.ts, quota-pull.ts); event_mapper.rs
// notes: wires account/rateLimits/updated to quota_rate_limit's normalizer.
