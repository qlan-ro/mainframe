//! Todo #327 — red-phase adapter tests (group A). Pins the sub-agent-activity
//! lifecycle against `BackgroundTaskTracker` before `CodexSessionState` carries
//! the fields the hooks need (group B, tasks 3-6, turns this green).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use std::sync::Arc;

use common::{RegistryRow, temp_registry};
use mainframe_adapter_codex::event_mapper::CodexSessionState;
use mainframe_background_tasks::tracker::BackgroundTaskTracker;

const CHAT_ID: &str = "chat-327";

/// `CodexSessionState` wired to a fresh `BackgroundTaskTracker` and a throwaway
/// thread registry, keyed the same way `main.rs` keys a live chat. Fails to
/// compile until `background_tasks`/`mainframe_chat_id` exist on
/// `CodexSessionState` (task 4) — that compile failure is this task's red
/// observation. Kept local to this binary (not `tests/common/mod.rs`) so the
/// red state is scoped to `collab_activity` alone; every codex test binary does
/// `mod common;`, so a helper referencing not-yet-added fields there would red
/// the whole suite.
#[allow(dead_code)]
fn state_with_tracker(
    rows: &[RegistryRow<'_>],
) -> (
    tempfile::TempDir,
    Arc<BackgroundTaskTracker>,
    CodexSessionState,
) {
    let (dir, registry_deps) = temp_registry(rows);
    let tracker = Arc::new(BackgroundTaskTracker::new());
    let state = CodexSessionState {
        registry_deps: Some(registry_deps),
        mainframe_chat_id: CHAT_ID.to_string(),
        background_tasks: Some(tracker.clone()),
        ..CodexSessionState::default()
    };
    (dir, tracker, state)
}
