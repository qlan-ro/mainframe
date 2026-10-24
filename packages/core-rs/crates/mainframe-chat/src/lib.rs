//! `mainframe-chat` — the `ChatManager` state machine and session orchestration.
//!
//! Active chats live in a shared `DashMap` registry of per-chat
//! `Arc<Mutex<ActiveChat>>` cells (`Registry`); the permission queue
//! stays FIFO per chat, and a chat lock is never held across an `.await` that
//! emits events or does session I/O.
#![forbid(unsafe_code)]
#![cfg_attr(
    test,
    allow(
        clippy::too_many_lines,
        clippy::unwrap_used,
        clippy::expect_used,
        reason = "Test assertions and scenarios"
    )
)]

macro_rules! storage_event {
    ($shared:expr, $result:expr $(, $fallback:expr)?) => {
        storage_event!($shared, None; $result $(, $fallback)?)
    };
    ($shared:expr, $chat_id:expr; $result:expr $(, $fallback:expr)?) => {
        match $result {
            Ok(value) => value,
            Err(error) => {
                $shared.report_storage_error($chat_id, &error);
                return $($fallback)?;
            }
        }
    };
}

pub mod attachment_processor;
pub mod attention_request;
pub mod chat_cwd;
pub mod chat_manager;
pub mod chat_surface;

mod chat_teardown;
pub mod config_manager;
pub mod config_respawn_guard;
pub mod config_transcripts;
pub mod context_tracker;
pub mod degraded_recovery;
pub mod event_handler;
pub mod external_session_service;
pub mod fork;
pub mod fork_cut;
pub mod handoff;
pub mod idle_offload;
pub mod idle_scanner;
pub mod lifecycle_manager;
pub mod message_cache;
pub mod message_markers;
pub mod no_persistence;
pub mod orchestration_hooks;
pub mod permission_handler;
pub mod permission_manager;
pub mod plan_mode_actions;
pub mod plan_mode_handler;
pub mod resolve_tuning;
pub mod resolve_tuning_for_chat;
pub mod segments;
pub mod title_generator;
pub mod transcript_presence;
pub mod types;
pub mod worktree_offer;
pub mod worktree_offer_scan;

mod history_cache;
mod history_restore;

#[cfg(any(test, feature = "test-support"))]
#[expect(dead_code, reason = "Shared test helpers")]
pub mod test_support;
#[cfg(any(test, feature = "test-support"))]
mod test_support_chat;

mod tool_call_timing;

mod chat_store;
