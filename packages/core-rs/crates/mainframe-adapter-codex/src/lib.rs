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
pub mod event_mapper;
pub mod history;
pub mod item_types;
pub mod jsonrpc;
pub mod plan_mode_handler;
pub mod rollout_reader;
pub mod session;
pub mod thread_registry;
pub mod turn_config;
pub mod types;

pub use adapter::{CodexAdapter, map_codex_model};
pub use plan_mode_handler::CodexPlanModeHandler;
pub use session::CodexSession;

// PORT STATUS: src/plugins/builtin/codex/index.ts (8 lines)
// confidence: high
// todos: 1
// notes: index.ts re-exports collapse here. TODO(port): index.ts `activate(ctx)`
// notes: needs mainframe-plugins PluginContext (not yet ported) to call
// notes: ctx.adapters.register + ctx.onUnload(killAll); deferred to that phase.
