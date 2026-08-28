//! `session/resume` (todo #350, plan task 15): replay from a cursor over the
//! stable item sequence the canonical encoder produces from history
//! reconstruction — the same ids a live-streamed turn would have used
//! (criterion 4's replay half) — plus redelivery of any still-open
//! permission gate. `ResumePort` mirrors `prompt::PromptPort`'s narrow-seam
//! rationale: `mainframe-chat` is this crate's prospective consumer, not a
//! dependency, so the port stays a plain trait a hand-written fake can
//! implement in tests.

use std::future::Future;
use std::pin::Pin;

use mainframe_types::acp::extensions::MAINFRAME_META_NAMESPACE;
use mainframe_types::acp::jsonrpc::{JsonRpcRequest, JsonRpcResponse};
use mainframe_types::acp::session::{ResumeSessionRequest, ResumeSessionResponse};
use mainframe_types::acp::update::SessionUpdate;
use mainframe_types::adapter::ControlRequest;
use mainframe_types::display::DisplayMessage;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::encoder::{self, EncodedItem};
use crate::gates;
use crate::rpc;
use crate::session_state::SessionState;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// The cursor `ResumeSessionRequest.replayFrom` carries — an opaque `Value`
/// on the vendored wire type (group A left the scheme to this task).
/// `Start` always full-replays; `Item` resumes after the named stable item.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ReplayCursor {
    Start,
    Item { item_id: String },
}

/// The chat-manager surface `session/resume` needs: display history plus any
/// still-open gate for `session_id`, gathered in one call — a production
/// implementation wraps `ChatManager::get_resume_snapshot`.
pub trait ResumePort: Send + Sync {
    fn resume_snapshot<'a>(
        &'a self,
        session_id: &'a str,
    ) -> BoxFuture<'a, (Vec<DisplayMessage>, Option<ControlRequest>)>;
}

/// Everything besides the JSON-RPC response a `session/resume` call
/// produces: the replay `session/update` notifications, and — when a gate
/// was open — the `session/request_permission` request redelivering it.
pub struct ResumeReplay {
    pub updates: Vec<SessionUpdate>,
    pub pending_permission_request: Option<JsonRpcRequest>,
    /// The raw `ControlRequest` behind `pending_permission_request` — the
    /// caller registers it against the redelivered request's id so the
    /// client's answer can be parsed (`gates::parse_answer`) later.
    pub pending_gate: Option<ControlRequest>,
    /// The full encoded item sequence the snapshot produced (not just the
    /// post-cursor `updates`) — the caller seeds its live diff state with
    /// this so streaming after a resume deltas against what the client now
    /// holds.
    pub items: Vec<EncodedItem>,
}

/// `session/resume` dispatch. Malformed params get the same structured
/// error as every other facade method; a resolved cursor always yields a
/// success response, since "unknown cursor" is itself a defined outcome
/// (full replay with the [`MAINFRAME_META_NAMESPACE`] `fullReplay` marker),
/// not an error (spec edge cases 9).
pub async fn dispatch_resume(
    request: JsonRpcRequest,
    port: &dyn ResumePort,
) -> (JsonRpcResponse, ResumeReplay) {
    let id = request.id;
    let empty = ResumeReplay {
        updates: Vec::new(),
        pending_permission_request: None,
        pending_gate: None,
        items: Vec::new(),
    };
    let Some(params) = request.params else {
        return (
            rpc::error_response(id, rpc::invalid_params("session/resume requires params")),
            empty,
        );
    };
    let resume: ResumeSessionRequest = match serde_json::from_value(params) {
        Ok(r) => r,
        Err(err) => {
            return (
                rpc::error_response(id, rpc::invalid_params(&err.to_string())),
                empty,
            );
        }
    };

    let (messages, pending) = port.resume_snapshot(&resume.session_id).await;
    let items = encoder::encode(&messages);
    let resolved = resolve_cursor(&items, resume.replay_from.as_ref());
    let (updates, full_replay) = replay(&items, resolved);

    let pending_permission_request = pending.as_ref().map(|request| {
        gates::build_request(
            &resume.session_id,
            gates::gate_request_id(&request.request_id),
            request,
        )
    });

    let response = ResumeSessionResponse {
        config_options: None,
        meta: full_replay.then(full_replay_meta),
    };
    let result = serde_json::to_value(response).unwrap_or(Value::Null);
    (
        rpc::success_response(id, result),
        ResumeReplay {
            updates,
            pending_permission_request,
            pending_gate: pending,
            items,
        },
    )
}

fn full_replay_meta() -> Value {
    serde_json::json!({ MAINFRAME_META_NAMESPACE: { "fullReplay": true } })
}

enum ResolvedCursor {
    Start,
    Found(usize),
    /// Cursor absent from the current item sequence — either never seen or
    /// pre-compaction (spec edge cases 9 treats both the same way).
    Unknown,
}

fn resolve_cursor(items: &[EncodedItem], replay_from: Option<&Value>) -> ResolvedCursor {
    let Some(value) = replay_from else {
        return ResolvedCursor::Start;
    };
    match serde_json::from_value::<ReplayCursor>(value.clone()) {
        Ok(ReplayCursor::Start) => ResolvedCursor::Start,
        Ok(ReplayCursor::Item { item_id }) => items
            .iter()
            .position(|item| item.id() == item_id)
            .map_or(ResolvedCursor::Unknown, ResolvedCursor::Found),
        Err(_) => ResolvedCursor::Unknown,
    }
}

/// Replay via [`SessionState::diff`] against a fresh state: items up to and
/// including the cursor are fed once (seeding them as "already known") and
/// discarded, so the collected diff creates only the items after it — full
/// frames, since a resume has no prior wire state to delta against.
fn replay(items: &[EncodedItem], resolved: ResolvedCursor) -> (Vec<SessionUpdate>, bool) {
    let mut state = SessionState::new();
    match resolved {
        ResolvedCursor::Start => (state.diff(items), false),
        ResolvedCursor::Found(cursor_idx) => {
            let _ = state.diff(&items[..=cursor_idx]);
            (state.diff(items), false)
        }
        ResolvedCursor::Unknown => (state.diff(items), true),
    }
}

#[cfg(test)]
mod tests;
