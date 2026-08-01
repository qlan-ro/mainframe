//! Reload-path card bookkeeping (todo #247 task 19) — the single-pass
//! counterpart to the live path's `collab_card.rs`/`collab_resolve.rs` split,
//! carved out of `history_convert.rs` to keep that file under the 300-line
//! ceiling. `history_convert::convert_thread_items` dispatches
//! `SubAgentActivity`/`CollabAgentToolCall` items here; rendering itself lives
//! in `history_collab.rs`.

use std::collections::HashMap;

use mainframe_types::chat::ChatMessage;

use crate::collab_protocol::{
    CollabCallStatus, CollabTool, SubAgentKind, classify_collab_status, classify_collab_tool,
    classify_sub_agent_kind,
};
use crate::history_collab::{child_last_message, emit_sub_agent_card, emit_sub_agent_result};
use crate::item_types::{CollabAgentToolCallItem, SubAgentActivityItem, ThreadItem};
use crate::thread_registry::AgentMetadata;

/// Invariant context threaded through the reload-path collab helpers below —
/// grouped into one struct so none of them needs more than clippy's
/// `too_many_arguments` threshold.
pub(crate) struct CollabCtx<'a> {
    pub(crate) chat_id: &'a str,
    pub(crate) child_items_by_thread: &'a HashMap<String, Vec<ThreadItem>>,
    pub(crate) agent_meta_by_thread: &'a HashMap<String, AgentMetadata>,
}

/// Reload-path bookkeeping for one child thread's card — the counterpart to
/// the live path's `SubAgentCard` (session_state.rs), scoped to a single
/// `convert_thread_items` pass. Entries persist once resolved (never removed)
/// so a later item naming the same child is recognized as already-carded
/// instead of opening a duplicate.
pub(crate) struct TrackedCard {
    card_id: String,
    resolved: bool,
}

pub(crate) type CardMap = HashMap<String, TrackedCard>;

/// `Started` registers the child and opens its card (a no-op if already
/// registered, so the activity route and a legacy `wait` naming the same child
/// produce exactly one card — spec decision 1); `Interrupted` resolves it as an
/// error; `Interacted`/`Unknown` have no card effect.
pub(crate) fn handle_sub_agent_activity(
    a: &SubAgentActivityItem,
    messages: &mut Vec<ChatMessage>,
    spawn_prompts: &HashMap<String, String>,
    cards: &mut CardMap,
    ctx: &CollabCtx,
) {
    match classify_sub_agent_kind(&a.kind) {
        SubAgentKind::Started => open_card(
            &a.agent_thread_id,
            a.id.clone(),
            a.agent_path.as_deref(),
            spawn_prompts.get(&a.agent_thread_id).map(String::as_str),
            messages,
            cards,
            ctx,
        ),
        SubAgentKind::Interrupted => resolve_card(
            &a.agent_thread_id,
            "Sub-agent interrupted",
            true,
            messages,
            ctx.chat_id,
            cards,
        ),
        SubAgentKind::Interacted | SubAgentKind::Unknown => {}
    }
}

pub(crate) fn handle_collab_tool_call(
    item: &CollabAgentToolCallItem,
    messages: &mut Vec<ChatMessage>,
    spawn_prompts: &mut HashMap<String, String>,
    cards: &mut CardMap,
    ctx: &CollabCtx,
) {
    match classify_collab_tool(&item.tool) {
        CollabTool::SpawnAgent => {
            if let (Some(children), Some(prompt)) = (&item.receiver_thread_ids, &item.prompt) {
                for child_id in children {
                    spawn_prompts.insert(child_id.clone(), prompt.clone());
                }
            }
        }
        CollabTool::Wait => on_wait(item, messages, spawn_prompts, cards, ctx),
        CollabTool::SendInput
        | CollabTool::ResumeAgent
        | CollabTool::CloseAgent
        | CollabTool::Unknown => {}
    }
}

/// A `wait` naming receivers resolves each of them (opening a card first when
/// none names it yet — the legacy route, design decision 1). A `wait` with an
/// empty receiver list can only fail every still-open card, never complete one
/// (design decision 2: an empty/unknown status is indistinguishable from a
/// timed-out wait).
fn on_wait(
    item: &CollabAgentToolCallItem,
    messages: &mut Vec<ChatMessage>,
    spawn_prompts: &HashMap<String, String>,
    cards: &mut CardMap,
    ctx: &CollabCtx,
) {
    let receivers = item.receiver_thread_ids.clone().unwrap_or_default();
    let status = classify_collab_status(&item.status);

    if receivers.is_empty() {
        if status == CollabCallStatus::Failed {
            for child in open_unresolved_children(cards) {
                resolve_card(
                    &child,
                    "Sub-agent failed",
                    true,
                    messages,
                    ctx.chat_id,
                    cards,
                );
            }
        }
        return;
    }

    for child in &receivers {
        open_card(
            child,
            item.id.clone(),
            None,
            spawn_prompts
                .get(child)
                .map(String::as_str)
                .or(item.prompt.as_deref()),
            messages,
            cards,
            ctx,
        );
        let agent_message = item
            .agents_states
            .as_ref()
            .and_then(|m| m.get(child))
            .and_then(|s| s.message.clone());
        if status == CollabCallStatus::Failed {
            let content = agent_message.unwrap_or_else(|| "Sub-agent failed".to_string());
            resolve_card(child, &content, true, messages, ctx.chat_id, cards);
        } else {
            let content = agent_message
                .or_else(|| child_last_message(ctx.child_items_by_thread.get(child)))
                .unwrap_or_else(|| "Sub-agent completed".to_string());
            resolve_card(child, &content, false, messages, ctx.chat_id, cards);
        }
    }
}

/// Registers `child_thread_id`'s card and emits its opening tool_use — a no-op
/// when the child is already known, regardless of whether that card has since
/// resolved (a resolved entry still blocks a duplicate open).
#[allow(clippy::too_many_arguments)]
fn open_card(
    child_thread_id: &str,
    card_id: String,
    agent_path: Option<&str>,
    prompt: Option<&str>,
    messages: &mut Vec<ChatMessage>,
    cards: &mut CardMap,
    ctx: &CollabCtx,
) {
    if cards.contains_key(child_thread_id) {
        return;
    }
    emit_sub_agent_card(
        messages,
        ctx.chat_id,
        &card_id,
        child_thread_id,
        agent_path,
        prompt,
        ctx.child_items_by_thread,
        ctx.agent_meta_by_thread,
    );
    cards.insert(
        child_thread_id.to_string(),
        TrackedCard {
            card_id,
            resolved: false,
        },
    );
}

/// Closes `child_thread_id`'s card — a no-op when unknown or already resolved,
/// so every naming route can race to resolve the same card and only the first
/// wins.
fn resolve_card(
    child_thread_id: &str,
    content: &str,
    is_error: bool,
    messages: &mut Vec<ChatMessage>,
    chat_id: &str,
    cards: &mut CardMap,
) {
    let Some(card) = cards.get_mut(child_thread_id) else {
        return;
    };
    if card.resolved {
        return;
    }
    let card_id = card.card_id.clone();
    card.resolved = true;
    emit_sub_agent_result(messages, chat_id, &card_id, content, is_error);
}

fn open_unresolved_children(cards: &CardMap) -> Vec<String> {
    cards
        .iter()
        .filter(|(_, c)| !c.resolved)
        .map(|(tid, _)| tid.clone())
        .collect()
}

/// Backstop: a card whose child never signals completion via `wait` or a
/// `subAgentActivity` interruption still closes, mirroring the live path's
/// parent-turn-end resolution.
pub(crate) fn resolve_open_cards(
    messages: &mut Vec<ChatMessage>,
    cards: &mut CardMap,
    ctx: &CollabCtx,
) {
    for child in open_unresolved_children(cards) {
        let content = child_last_message(ctx.child_items_by_thread.get(&child))
            .unwrap_or_else(|| "Sub-agent completed".to_string());
        resolve_card(&child, &content, false, messages, ctx.chat_id, cards);
    }
}
