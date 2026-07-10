//! `mainframe-chat` — the `ChatManager` state machine and session orchestration.
//!
//! Ported from `packages/core/src/chat/*` (one `.rs` per `.ts`, crate map §2.10;
//! `index.ts` re-exports collapse into this `lib.rs`). Port order is leaves first,
//! `chat_manager` last. The five chatId-keyed maps fold into ONE `ChatState`
//! behind one per-chat `Arc<Mutex<ChatState>>` (registry is a `SHARED_MAP`); the
//! permission queue stays FIFO per chat and the chat lock is never held across an
//! `.await` that emits events or does session I/O (CONCURRENCY.tsv rules 1-4).
//!
//! Task 4.1 pre-created these module files so parallel port agents never touch a
//! shared `lib.rs`. Each module is an empty skeleton pending its per-file port.
#![forbid(unsafe_code)]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

pub mod attachment_processor;
pub mod chat_manager;
pub mod config_manager;
pub mod context_tracker;
pub mod display_emitter;
pub mod event_handler;
pub mod external_session_service;
pub mod idle_scanner;
pub mod lifecycle_manager;
pub mod message_cache;
pub mod permission_handler;
pub mod permission_manager;
pub mod plan_mode_actions;
pub mod plan_mode_handler;
pub mod resolve_tuning;
pub mod resolve_tuning_for_chat;
pub mod title_generator;
pub mod types;

#[cfg(test)]
mod test_support;

// PORT STATUS: src/chat/* — skeleton only (Task 4.1)
// confidence: low
// todos: 0
// notes: module stubs pre-created for parallel ports; no logic yet. Consumes the
// notes: mainframe-adapter-api traits (sessions are Arc<dyn AdapterSession>).
