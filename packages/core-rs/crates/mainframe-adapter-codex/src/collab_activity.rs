//! Todo #327 — the sub-agent-activity half of the collab card engine. Every
//! function here mirrors a `collab_card`/`collab_resolve` hook one-to-one
//! (task 6), so a tracker row can never open or close without its card doing
//! the same. A `None` tracker (production default, every existing test state)
//! makes every function a no-op.

use mainframe_background_tasks::tracker::{TaskSeed, TerminalUpdate};
use mainframe_types::background_task::{
    BackgroundTaskStatus, BackgroundTaskToolName, BackgroundWorkKind,
};
use nanoid::nanoid;

use crate::session_state::CodexSessionState;

/// Opens one `agent` row for `child_thread_id`, described by the card's own
/// `title` (fact 8 — never a raw thread id) so the row and the card can never
/// disagree. A no-op with no tracker, no chat id (P3), or a child already
/// tracked (dedupe — AC 4).
pub(crate) fn open_activity(
    child_thread_id: &str,
    card_id: &str,
    title: &str,
    state: &mut CodexSessionState,
) {
    let Some(tracker) = state.background_tasks.clone() else {
        return;
    };
    if state.mainframe_chat_id.is_empty() {
        return;
    }
    if state.agent_task_ids.contains_key(child_thread_id) {
        return;
    }
    let task_id = format!("codex-agent-{}", nanoid!());
    tracker.start(
        &state.mainframe_chat_id,
        TaskSeed {
            id: task_id.clone(),
            kind: BackgroundWorkKind::Agent,
            tool_name: BackgroundTaskToolName::Bash,
            tool_use_id: card_id.to_string(),
            command: title.to_string(),
            description: title.to_string(),
            workflow_name: None,
        },
        String::new(),
    );
    state
        .agent_task_ids
        .insert(child_thread_id.to_string(), task_id);
}

/// Ends `child_thread_id`'s row, if it has one. A no-op with no tracker or no
/// tracked id — `BackgroundTaskTracker::end` is itself idempotent on an
/// already-terminal or unknown id (fact 5), so a race between two closing
/// routes can never emit a second `ended`.
pub(crate) fn end_activity(child_thread_id: &str, state: &mut CodexSessionState) {
    let Some(task_id) = state.agent_task_ids.remove(child_thread_id) else {
        return;
    };
    let Some(tracker) = state.background_tasks.clone() else {
        return;
    };
    tracker.end(
        &state.mainframe_chat_id,
        &task_id,
        TerminalUpdate {
            status: BackgroundTaskStatus::Completed,
            output_path: String::new(),
            summary: String::new(),
            usage: None,
        },
    );
}

/// The parent-turn-end backstop (P2): ends every row still tracked, mirroring
/// the card engine's own `resolve_open_cards_on_parent_turn_end`.
pub(crate) fn end_all_activity(state: &mut CodexSessionState) {
    let children: Vec<String> = state.agent_task_ids.keys().cloned().collect();
    for child in children {
        end_activity(&child, state);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use mainframe_background_tasks::tracker::BackgroundTaskTracker;

    use super::*;

    fn state_with(tracker: Option<Arc<BackgroundTaskTracker>>, chat_id: &str) -> CodexSessionState {
        CodexSessionState {
            mainframe_chat_id: chat_id.to_string(),
            background_tasks: tracker,
            ..CodexSessionState::default()
        }
    }

    #[test]
    fn open_activity_is_a_no_op_without_a_tracker() {
        let mut state = state_with(None, "chat-1");
        open_activity("child-1", "card-1", "Maxwell", &mut state);
        assert!(state.agent_task_ids.is_empty());
    }

    #[test]
    fn open_activity_is_a_no_op_with_an_empty_chat_id() {
        let tracker = Arc::new(BackgroundTaskTracker::new());
        let mut state = state_with(Some(tracker.clone()), "");
        open_activity("child-1", "card-1", "Maxwell", &mut state);
        assert!(state.agent_task_ids.is_empty());
        assert!(tracker.list_live("").is_empty());
    }

    #[test]
    fn end_activity_is_a_no_op_without_a_tracked_id() {
        let mut state = state_with(None, "chat-1");
        end_activity("child-1", &mut state); // must not panic
    }
}
