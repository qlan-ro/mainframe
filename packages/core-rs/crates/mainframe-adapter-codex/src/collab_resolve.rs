//! Resolution-side half of the CollabAgent card engine (`collab_card.rs`'s
//! sibling, split out to stay under the 300-line ceiling): closing a card via
//! `wait`'s `receiverThreadIds`/`agentsStates`, or failing every open card on
//! an unnamed `wait` failure (spec decision 2).

use std::sync::Arc;

use mainframe_adapter_api::SessionSink;

use crate::collab_activity::end_activity;
use crate::collab_card::open_card;
use crate::collab_protocol::{CollabCallStatus, classify_collab_status};
use crate::history::tool_result_block;
use crate::item_types::CollabAgentToolCallItem;
use crate::session_state::CodexSessionState;

/// How a card's closing `tool_result` should read. `Success`'s `Option<String>`
/// is an explicit message override (e.g. `agentsStates[child].message`); `None`
/// falls back to the card's own `last_message`.
pub(crate) enum Outcome {
    Success(Option<String>),
    Error(String),
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
    sink.on_tool_result(
        vec![tool_result_block(&card_id, &content, is_error, None)],
        Some(format!("{card_id}:result")),
    );
    if let Some(card) = state.sub_agent_cards.get_mut(child_thread_id) {
        card.open = false;
        card.resolved = true;
    }
    // The stashed spawn prompt only ever fed a card's opening description — once
    // resolved, nothing consults it again.
    state.spawn_prompts.remove(child_thread_id);
    end_activity(child_thread_id, state);
}

pub(crate) fn on_wait_started(
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
pub(crate) fn on_wait_completed(
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
        // A `wait` can complete before any `started` ping named this child —
        // `open_card` no-ops once it already has, so this never double-cards.
        open_card(
            child,
            item.id.clone(),
            None,
            item.prompt.as_deref(),
            sink,
            state,
        );
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

pub(crate) fn open_unresolved_children(state: &CodexSessionState) -> Vec<String> {
    state
        .sub_agent_cards
        .iter()
        .filter(|(_, c)| c.open && !c.resolved)
        .map(|(tid, _)| tid.clone())
        .collect()
}
