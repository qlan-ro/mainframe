//! Todo #247 (CollabAgent sub-agent delegation): the card engine. Every naming
//! route (subAgentActivity, wait's receiverThreadIds, a child's own
//! turn/completed, the parent-turn-end backstop) funnels through here, so a
//! child is ever represented by exactly one card (spec decision 1). Wired into
//! the live path by `thread_item_render.rs` and `event_mapper.rs` (tasks 16-17).

use std::sync::Arc;

use mainframe_adapter_api::SessionSink;

use crate::collab_identity::{card_task_line, card_title};
use crate::collab_protocol::{
    CollabCallStatus, CollabTool, SubAgentKind, classify_collab_status, classify_collab_tool,
    classify_sub_agent_kind,
};
use crate::history::{collab_agent_tool_use, tool_result_block};
use crate::item_types::{CollabAgentToolCallItem, SubAgentActivityItem};
use crate::session_state::{CodexSessionState, SubAgentCard};
use crate::thread_registry::lookup_agent_metadata_with;

/// Which half of a `collabAgentToolCall`'s lifecycle dispatched it — `wait`
/// behaves differently in each (`Started` opens legacy-route cards named by
/// `receiverThreadIds`; `Completed` resolves them).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Phase {
    Started,
    Completed,
}

/// How a card's closing `tool_result` should read. `Success`'s `Option<String>`
/// is an explicit message override (e.g. `agentsStates[child].message`); `None`
/// falls back to the card's own `last_message`.
pub(crate) enum Outcome {
    Success(Option<String>),
    Error(String),
}

pub(crate) fn on_sub_agent_activity(
    item: &SubAgentActivityItem,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    match classify_sub_agent_kind(&item.kind) {
        SubAgentKind::Started => open_card(
            &item.agent_thread_id,
            item.id.clone(),
            item.agent_path.as_deref(),
            None,
            sink,
            state,
        ),
        SubAgentKind::Interrupted => resolve_card(
            &item.agent_thread_id,
            Outcome::Error("Sub-agent interrupted".to_string()),
            sink,
            state,
        ),
        SubAgentKind::Interacted | SubAgentKind::Unknown => tracing::debug!(
            module = "codex:collab",
            kind = %item.kind,
            "codex: subAgentActivity ping has no card effect"
        ),
    }
}

/// Registers `child_thread_id` and emits its opening `CollabAgent` tool_use. A
/// no-op when the child is already registered — the activity route and the
/// legacy `receiverThreadIds` route can both name the same child (spec
/// decision 1), and must still produce exactly one card.
pub(crate) fn open_card(
    child_thread_id: &str,
    card_id: String,
    agent_path: Option<&str>,
    prompt: Option<&str>,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    if state.sub_agent_cards.contains_key(child_thread_id) {
        return;
    }
    let ids = [child_thread_id.to_string()];
    let meta_by_thread = lookup_agent_metadata_with(&ids, state.registry_deps.as_ref());
    let title = card_title(meta_by_thread.get(child_thread_id), agent_path);
    let prompt_text = prompt
        .map(str::to_string)
        .or_else(|| state.spawn_prompts.get(child_thread_id).cloned())
        .unwrap_or_default();
    let description = card_task_line(Some(prompt_text.as_str()).filter(|p| !p.is_empty()), &title);

    state.sub_agent_cards.insert(
        child_thread_id.to_string(),
        SubAgentCard {
            card_id: card_id.clone(),
            title: title.clone(),
            open: true,
            resolved: false,
            last_message: None,
        },
    );
    sink.on_message(
        vec![collab_agent_tool_use(
            &card_id,
            &prompt_text,
            &description,
            &title,
        )],
        None,
    );
}

/// Records the child's latest non-empty `agentMessage` text as the fallback
/// closing content for its card (spec decision 5). A no-op for unregistered
/// children or blank text.
pub(crate) fn record_child_message(
    child_thread_id: &str,
    text: &str,
    state: &mut CodexSessionState,
) {
    if text.is_empty() {
        return;
    }
    if let Some(card) = state.sub_agent_cards.get_mut(child_thread_id) {
        card.last_message = Some(text.to_string());
    }
}

/// Closes `child_thread_id`'s card with a `tool_result`. A no-op when the card
/// is absent or already resolved — every naming route can race to resolve the
/// same card, and only the first should win.
pub(crate) fn resolve_card(
    child_thread_id: &str,
    outcome: Outcome,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    let Some(card) = state.sub_agent_cards.get(child_thread_id) else {
        return;
    };
    if card.resolved {
        return;
    }
    let card_id = card.card_id.clone();
    let (content, is_error) = match outcome {
        Outcome::Success(message) => (
            message
                .or_else(|| card.last_message.clone())
                .unwrap_or_else(|| "Sub-agent completed".to_string()),
            false,
        ),
        Outcome::Error(message) => (message, true),
    };
    sink.on_tool_result(vec![tool_result_block(&card_id, &content, is_error, None)]);
    if let Some(card) = state.sub_agent_cards.get_mut(child_thread_id) {
        card.open = false;
        card.resolved = true;
    }
}

/// Re-opens a resolved card for a fresh `sendInput`/`resumeAgent` round without
/// creating a second one (spec decision 4). A no-op for unregistered children.
pub(crate) fn reopen_card(child_thread_id: &str, state: &mut CodexSessionState) {
    if let Some(card) = state.sub_agent_cards.get_mut(child_thread_id) {
        card.open = true;
        card.resolved = false;
    }
}

pub(crate) fn stash_spawn_prompts(item: &CollabAgentToolCallItem, state: &mut CodexSessionState) {
    if let (Some(children), Some(prompt)) = (&item.receiver_thread_ids, &item.prompt) {
        for child_id in children {
            state.spawn_prompts.insert(child_id.clone(), prompt.clone());
        }
    }
}

pub(crate) fn on_collab_tool_call(
    item: &CollabAgentToolCallItem,
    phase: Phase,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    match classify_collab_tool(&item.tool) {
        CollabTool::SpawnAgent => stash_spawn_prompts(item, state),
        CollabTool::SendInput | CollabTool::ResumeAgent => {
            for child in item.receiver_thread_ids.iter().flatten() {
                reopen_card(child, state);
            }
        }
        CollabTool::Wait => match phase {
            Phase::Started => on_wait_started(item, sink, state),
            Phase::Completed => on_wait_completed(item, sink, state),
        },
        CollabTool::CloseAgent | CollabTool::Unknown => tracing::debug!(
            module = "codex:collab",
            tool = %item.tool,
            "codex: collab tool call has no card effect"
        ),
    }
}

fn on_wait_started(
    item: &CollabAgentToolCallItem,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    for child in item.receiver_thread_ids.iter().flatten() {
        open_card(
            child,
            item.id.clone(),
            None,
            item.prompt.as_deref(),
            sink,
            state,
        );
    }
}

/// An unnamed (`receiverThreadIds` empty) `wait` can only ever fail cards, never
/// complete them — an empty/unknown status is indistinguishable from a
/// timed-out wait, so treating it as success would risk closing a card no
/// child actually finished (spec decision 2). Success on the unnamed route only
/// ever arrives via the child's own `turn/completed` or the parent-turn-end
/// backstop.
fn on_wait_completed(
    item: &CollabAgentToolCallItem,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    let receivers = item.receiver_thread_ids.clone().unwrap_or_default();
    let status = classify_collab_status(&item.status);
    if receivers.is_empty() {
        if status == CollabCallStatus::Failed {
            fail_all_open_cards(sink, state);
        }
        return;
    }
    for child in &receivers {
        let agent_message = item
            .agents_states
            .as_ref()
            .and_then(|m| m.get(child))
            .and_then(|s| s.message.clone());
        if status == CollabCallStatus::Failed {
            let content = agent_message.unwrap_or_else(|| "Sub-agent failed".to_string());
            resolve_card(child, Outcome::Error(content), sink, state);
        } else {
            resolve_card(child, Outcome::Success(agent_message), sink, state);
        }
    }
}

fn fail_all_open_cards(sink: &Arc<dyn SessionSink>, state: &mut CodexSessionState) {
    for child in open_unresolved_children(state) {
        resolve_card(
            &child,
            Outcome::Error("Sub-agent failed".to_string()),
            sink,
            state,
        );
    }
}

fn open_unresolved_children(state: &CodexSessionState) -> Vec<String> {
    state
        .sub_agent_cards
        .iter()
        .filter(|(_, c)| c.open && !c.resolved)
        .map(|(tid, _)| tid.clone())
        .collect()
}

pub(crate) fn on_sub_agent_turn_completed(
    child_thread_id: &str,
    turn_status: &str,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    let is_error = turn_status == "failed" || turn_status == "interrupted";
    let outcome = if is_error {
        Outcome::Error("Sub-agent failed".to_string())
    } else {
        Outcome::Success(None)
    };
    resolve_card(child_thread_id, outcome, sink, state);
}

/// Backstop for a card whose child never signals completion via `wait` or its
/// own `turn/completed` — closes it with whatever `last_message` it has when
/// the parent's own turn ends.
pub(crate) fn resolve_open_cards_on_parent_turn_end(
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    for child in open_unresolved_children(state) {
        resolve_card(&child, Outcome::Success(None), sink, state);
    }
}
