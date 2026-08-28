//! `session/prompt` / `session/cancel` dispatch (todo #350, plan task 14).
//!
//! [`PromptPort`] is a narrow surface over a live `ChatManager` — deliberately
//! not a dependency on `mainframe-chat` itself. That crate is `mainframe-acp`'s
//! prospective consumer, not the other way around, and pulling it in (plus
//! `mainframe-adapter-*` for a runnable session) to exercise one trait would
//! mean hand-building a second copy of `mainframe-chat`'s own
//! `ChatManagerDeps` test fake (a ~40-method trait) with no reuse of the
//! existing one (private to `mainframe-chat::chat_manager::tests`). The
//! end-to-end proof that `ChatManager::send_message`/`interrupt_chat` produce
//! the right chat-surface events instead lives in
//! `mainframe-chat/src/chat_manager/tests/chat_surface_wiring.rs`; this
//! module's tests cover the wire-frame shape (criterion 5's no-`queue.*`
//! acceptance payload, criterion 6's cancel routing, the dead-session edge
//! case) against a hand-written [`PromptPort`] fake.

use std::future::Future;
use std::pin::Pin;

use mainframe_types::acp::extensions::{MAINFRAME_META_NAMESPACE, QueuedPromptState};
use mainframe_types::acp::jsonrpc::{
    JsonRpcErrorObject, JsonRpcRequest, JsonRpcResponse, error_codes,
};
use mainframe_types::acp::session::{CancelSessionNotification, PromptRequest, PromptResponse};
use serde_json::{Value, json};

use crate::rpc;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// `session/prompt`'s acceptance (spec: "immediate acceptance distinct from
/// turn completion"). `queued_position` mirrors `ChatManager::send_message`'s
/// own queued-vs-immediate branch (`send.rs`'s `queued_message_metadata`) —
/// `None` for a free chat, `Some(n)` behind a running turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptAcceptance {
    pub queued_position: Option<i64>,
}

/// A session the port could not act on (edge case: prompt/cancel to a dead or
/// degraded session).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromptError {
    pub message: String,
}

/// The chat-manager surface `session/prompt`/`session/cancel` dispatch needs.
/// A production implementation wraps a live `ChatManager`
/// (`send_message`/`interrupt_chat`) — owned by `mainframe-server`, outside
/// this crate's file list.
pub trait PromptPort: Send + Sync {
    fn send_prompt<'a>(
        &'a self,
        session_id: &'a str,
        text: &'a str,
    ) -> BoxFuture<'a, Result<PromptAcceptance, PromptError>>;
    /// End the turn (cancelled stop reason) and cancel open gates —
    /// `ChatManager::interrupt_chat` already does both (`lifecycle_manager.rs`:
    /// `perms.clear` + `mark_interrupted`, which flows into `on_result`'s
    /// stop-reason mapping via the chat-surface seam, task 10).
    fn cancel<'a>(&'a self, session_id: &'a str) -> BoxFuture<'a, Result<(), PromptError>>;
}

/// `session/prompt` request → [`PromptPort::send_prompt`] → `PromptResponse`.
/// No `queue.*` frame family exists on the facade (criterion 5): a queued
/// acceptance is this same response shape with the extension `_meta` set.
pub async fn dispatch_prompt(request: JsonRpcRequest, port: &dyn PromptPort) -> JsonRpcResponse {
    let id = request.id;
    let Some(params) = request.params else {
        return rpc::error_response(id, rpc::invalid_params("session/prompt requires params"));
    };
    let prompt: PromptRequest = match serde_json::from_value(params) {
        Ok(p) => p,
        Err(err) => return rpc::error_response(id, rpc::invalid_params(&err.to_string())),
    };
    let text = extract_text(&prompt.prompt);
    match port.send_prompt(&prompt.session_id, &text).await {
        Ok(acceptance) => {
            let meta = acceptance.queued_position.map(
                |position| json!({ MAINFRAME_META_NAMESPACE: QueuedPromptState { position } }),
            );
            let response = PromptResponse { meta };
            rpc::success_response(id, serde_json::to_value(response).unwrap_or(Value::Null))
        }
        Err(err) => rpc::error_response(id, session_unavailable(&err.message)),
    }
}

/// `session/cancel` is a notification (no reply per JSON-RPC 2.0) — a
/// malformed or unparseable payload is silently dropped rather than crashing
/// the connection, matching the dispatcher's existing notification handling.
pub async fn dispatch_cancel(params: Option<Value>, port: &dyn PromptPort) {
    let Some(params) = params else { return };
    let Ok(notification) = serde_json::from_value::<CancelSessionNotification>(params) else {
        return;
    };
    let _ = port.cancel(&notification.session_id).await;
}

fn extract_text(prompt: &[mainframe_types::acp::content::ContentBlock]) -> String {
    prompt
        .iter()
        .map(|block| {
            let mainframe_types::acp::content::ContentBlock::Text { text } = block;
            text.as_str()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn session_unavailable(message: &str) -> JsonRpcErrorObject {
    JsonRpcErrorObject {
        code: error_codes::RESOURCE_NOT_FOUND,
        message: format!("session unavailable: {message}"),
        data: None,
    }
}

#[cfg(test)]
mod tests;
