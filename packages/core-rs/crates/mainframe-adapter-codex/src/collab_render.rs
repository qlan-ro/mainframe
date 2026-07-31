//! Moved out of `thread_item_render.rs` (task 10, todo #247) to keep that file
//! under the 300-line ceiling. CollabAgent delegation rendering — a stub keyed
//! off `sub_agent_cards`; `collab_card.rs` (task 15) replaces this with the
//! agent-path-derived identity fix.

use std::sync::Arc;

use mainframe_adapter_api::SessionSink;

use crate::collab_identity::{card_task_line, card_title};
use crate::collab_protocol::{
    CollabCallStatus, CollabTool, SubAgentKind, classify_collab_status, classify_collab_tool,
    classify_sub_agent_kind,
};
use crate::event_mapper::CodexSessionState;
use crate::history::{collab_agent_tool_use, tool_result_block};
use crate::item_types::{CollabAgentToolCallItem, SubAgentActivityItem};
use crate::session_state::SubAgentCard;
use crate::thread_registry::lookup_agent_metadata_with;

pub(crate) fn handle_collab_completed(
    item: CollabAgentToolCallItem,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    // `spawnAgent` is dispatch metadata only — stash its prompt for the `wait` card.
    if classify_collab_tool(&item.tool) == CollabTool::SpawnAgent {
        stash_spawn_prompts(&item, state);
        return;
    }
    let children = item.receiver_thread_ids.clone().unwrap_or_default();
    let child_id = children.first();
    // An `interrupted` subAgentActivity ping may have already closed this card with
    // an error result; don't re-open the start block or double-emit the result.
    let already_resolved = child_id
        .and_then(|c| state.card_for_thread(c))
        .map(|c| c.resolved)
        .unwrap_or(false);
    if !already_resolved {
        let already_open = child_id
            .and_then(|c| state.card_for_thread(c))
            .map(|c| c.open)
            .unwrap_or(false);
        if !already_open {
            emit_collab_task_group_start(&item, sink, state);
        }
        let sub_agent_message = child_id
            .and_then(|c| item.agents_states.as_ref().and_then(|s| s.get(c)))
            .and_then(|s| s.message.clone());
        let is_error = matches!(
            classify_collab_status(&item.status),
            CollabCallStatus::Failed
        ) || item.status == "interrupted";
        let content = sub_agent_message.unwrap_or_else(|| "Sub-agent completed".to_string());
        sink.on_tool_result(vec![tool_result_block(&item.id, &content, is_error, None)]);
    }
    // Stop routing further items from this spawn's child thread(s) and drop the prompt.
    for cid in &children {
        state.sub_agent_cards.remove(cid);
        state.spawn_prompts.remove(cid);
    }
}

/// `started`/`interacted` pings have nothing to update (the TaskCard carries no
/// status field beyond `isError`/`isRunning`); `interrupted` resolves the parent
/// CollabAgent card to an errored state early, ahead of its own `wait` completion.
pub(crate) fn handle_sub_agent_activity(
    item: &SubAgentActivityItem,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    if classify_sub_agent_kind(&item.kind) != SubAgentKind::Interrupted {
        tracing::debug!(
            module = "codex:events",
            kind = %item.kind,
            "codex: subAgentActivity ping has no TaskCard effect"
        );
        return;
    }
    let Some(card_id) = state
        .card_for_thread(&item.agent_thread_id)
        .map(|c| c.card_id.clone())
    else {
        tracing::debug!(
            module = "codex:events",
            agent_thread_id = %item.agent_thread_id,
            "codex: interrupted subAgentActivity for an unregistered agent thread"
        );
        return;
    };
    sink.on_tool_result(vec![tool_result_block(
        &card_id,
        "Sub-agent interrupted",
        true,
        None,
    )]);
    if let Some(card) = state.sub_agent_cards.get_mut(&item.agent_thread_id) {
        card.resolved = true;
    }
}

pub(crate) fn stash_spawn_prompts(item: &CollabAgentToolCallItem, state: &mut CodexSessionState) {
    if let (Some(children), Some(prompt)) = (&item.receiver_thread_ids, &item.prompt) {
        for child_id in children {
            state.spawn_prompts.insert(child_id.clone(), prompt.clone());
        }
    }
}

pub(crate) fn emit_collab_task_group_start(
    item: &CollabAgentToolCallItem,
    sink: &Arc<dyn SessionSink>,
    state: &mut CodexSessionState,
) {
    let children = item.receiver_thread_ids.clone().unwrap_or_default();
    // One lookup covers both the title/description derivation below and each
    // child's rollout_path for the live tail — the brief calls out not to
    // look this up twice.
    let meta_by_thread = lookup_agent_metadata_with(&children, state.registry_deps.as_ref());
    let child_id = children.first();
    let meta = child_id.and_then(|c| meta_by_thread.get(c));
    let subagent_type = card_title(meta, None);
    let prompt = child_id
        .and_then(|c| state.spawn_prompts.get(c).cloned())
        .or_else(|| item.prompt.clone())
        .unwrap_or_default();
    let description = card_task_line(
        Some(prompt.as_str()).filter(|p| !p.is_empty()),
        &subagent_type,
    );
    // Register the spawned thread(s) so subsequent child items get tagged.
    for child_id in &children {
        state.sub_agent_cards.insert(
            child_id.clone(),
            SubAgentCard {
                card_id: item.id.clone(),
                title: subagent_type.clone(),
                open: true,
                resolved: false,
                last_message: None,
            },
        );
    }
    sink.on_message(
        vec![collab_agent_tool_use(
            &item.id,
            &prompt,
            &description,
            &subagent_type,
        )],
        None,
    );
}
