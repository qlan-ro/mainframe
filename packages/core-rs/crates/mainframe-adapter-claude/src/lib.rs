//! `mainframe-adapter-claude` — the Claude CLI integration (stream-json).
//!
//! Ported from `packages/core/src/plugins/builtin/claude/*` plus the
//! Claude-specific slice of `packages/core/src/messages/*` (crate map §2.7;
//! `index.ts` re-exports collapse into this `lib.rs`). The stream-json event
//! shapes, spawn args, stdin `control_request` envelopes, SIGTERM→SIGKILL + 10s
//! SIGINT interrupt semantics, and JSONL history formats are copied exactly from
//! the TS source and its tests; unknown inbound event types are logged once per
//! type and skipped — never a hard error.
//!
//! Task 4.1 pre-created these module files so parallel port agents never touch a
//! shared `lib.rs`. Each module is an empty skeleton pending its per-file port.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod adapter;
pub mod assistant_event;
pub mod constants;
pub mod context_files;
pub mod events;
pub mod external_session_cache;
pub mod external_session_enrich;
pub mod external_session_paths;
pub mod external_sessions;
pub mod frontmatter;
pub mod history;
pub mod history_converters;
pub mod history_subagents;
pub mod history_tool_result;
pub mod messages;
pub mod plan_mode_handler;
pub mod pr_detection;
pub mod probe_models;
pub mod quota_parse;
pub mod quota_pull;
pub mod quota_rate_limit;
pub mod session;
pub mod session_control;
pub mod skill_path;
pub mod skills;
pub mod task_events;
pub mod title_generator;
pub mod transcript;
pub mod trust_store;
pub mod tuning;
pub mod user_event;

// PORT STATUS: src/plugins/builtin/claude/* + messages/* (claude slice) — skeleton only (Task 4.1)
// confidence: low
// todos: 0
// notes: module stubs pre-created for parallel ports; no logic yet. Implements the
// notes: mainframe-adapter-api Adapter/AdapterSession/SessionSink traits when ported.
// notes: `messages` holds the Claude-specific message files (§2.5 split); the
// notes: adapter-agnostic pieces live in mainframe-display.
