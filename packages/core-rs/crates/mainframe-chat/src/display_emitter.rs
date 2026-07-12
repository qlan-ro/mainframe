//! Ported from `packages/core/src/chat/display-emitter.ts`.

use std::collections::HashMap;

use mainframe_types::chat::ChatMessage;
use mainframe_types::display::{DisplayMessage, ToolCategories};
use mainframe_types::events::DaemonEvent;

use crate::message_cache::MessageCache;

/// The Claude-specific display pipeline (`prepareMessagesForClient`) lives in
/// `mainframe-adapter-claude` (crate map §2.5/§2.7), which this crate cannot depend
/// on without a cycle. It is therefore INJECTED — chat_manager passes the adapter's
/// `prepare_messages_for_client` here.
pub type PrepareFn<'a> =
    dyn Fn(&[ChatMessage], Option<&ToolCategories>) -> Vec<DisplayMessage> + 'a;

/// Compares old and new display message arrays and emits the appropriate
/// display.message.added / display.message.updated / display.messages.set
/// events. Updates the display cache in place.
pub fn emit_display_delta(
    chat_id: &str,
    messages: &MessageCache,
    display_cache: &mut HashMap<String, Vec<DisplayMessage>>,
    categories: Option<&ToolCategories>,
    prepare: &PrepareFn<'_>,
    emit_event: &mut dyn FnMut(DaemonEvent),
) {
    let raw: &[ChatMessage] = messages.get(chat_id).map(Vec::as_slice).unwrap_or(&[]);
    let new_display = prepare(raw, categories);
    let old_display = display_cache.get(chat_id).cloned().unwrap_or_default();

    if old_display.is_empty() {
        if !new_display.is_empty() {
            emit_event(DaemonEvent::DisplayMessagesSet {
                chat_id: chat_id.to_string(),
                messages: new_display.clone(),
            });
        }
    } else if new_display.len() > old_display.len() {
        // Messages added — check if it's a pure append (existing messages unchanged)
        let is_append = old_display
            .iter()
            .enumerate()
            .all(|(i, msg)| msg.id == new_display[i].id);
        if is_append {
            // Emit updates for any existing messages that changed (e.g. tool_result merged)
            for i in 0..old_display.len() {
                if display_message_changed(&old_display[i], &new_display[i]) {
                    emit_event(DaemonEvent::DisplayMessageUpdated {
                        chat_id: chat_id.to_string(),
                        message: new_display[i].clone(),
                    });
                }
            }
            // Emit added for each new message
            for msg in new_display.iter().skip(old_display.len()) {
                emit_event(DaemonEvent::DisplayMessageAdded {
                    chat_id: chat_id.to_string(),
                    message: msg.clone(),
                });
            }
        } else {
            emit_event(DaemonEvent::DisplayMessagesSet {
                chat_id: chat_id.to_string(),
                messages: new_display.clone(),
            });
        }
    } else if new_display.len() < old_display.len() {
        // Messages removed — full reset
        emit_event(DaemonEvent::DisplayMessagesSet {
            chat_id: chat_id.to_string(),
            messages: new_display.clone(),
        });
    } else {
        // Same count — check for order changes or per-message updates
        let order_changed = new_display
            .iter()
            .enumerate()
            .any(|(i, msg)| msg.id != old_display[i].id);
        if order_changed {
            emit_event(DaemonEvent::DisplayMessagesSet {
                chat_id: chat_id.to_string(),
                messages: new_display.clone(),
            });
        } else {
            // Same count, same order — emit updates for any messages that changed
            for i in 0..new_display.len() {
                if display_message_changed(&old_display[i], &new_display[i]) {
                    emit_event(DaemonEvent::DisplayMessageUpdated {
                        chat_id: chat_id.to_string(),
                        message: new_display[i].clone(),
                    });
                }
            }
        }
    }

    display_cache.insert(chat_id.to_string(), new_display);
}

/// Quick check whether a display message changed (content blocks or metadata).
fn display_message_changed(a: &DisplayMessage, b: &DisplayMessage) -> bool {
    if a.content.len() != b.content.len() {
        return true;
    }
    // Metadata change (e.g. queued badge cleared). TS compares `JSON.stringify(meta
    // ?? {})`, so absent and empty-object metadata are equal.
    let empty = HashMap::new();
    let a_meta = a.metadata.as_ref().unwrap_or(&empty);
    let b_meta = b.metadata.as_ref().unwrap_or(&empty);
    if a_meta != b_meta {
        return true;
    }
    // Content block change — compare by value (mirrors the TS per-block JSON compare).
    for i in 0..a.content.len() {
        if a.content[i] != b.content[i] {
            return true;
        }
    }
    false
}

// PORT STATUS: src/chat/display-emitter.ts (76 lines)
// confidence: high
// todos: 0
// notes: `prepareMessagesForClient` is Claude-specific (crate map §2.5/§2.7,
// notes: mainframe-adapter-claude) and would form a Cargo cycle if depended on here,
// notes: so it is INJECTED via `PrepareFn` (chat_manager passes the adapter's fn).
// notes: `emitEvent` → `&mut dyn FnMut(DaemonEvent)`; `displayCache: Map<...>` →
// notes: `&mut HashMap`. Control flow (append/reset/order-change/update branches) is
// notes: preserved 1:1; `JSON.stringify` equality → serde-`PartialEq` value equality
// notes: (`meta ?? {}` normalized so None == empty). No TS test file.
