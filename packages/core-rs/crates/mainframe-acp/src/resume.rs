use std::collections::HashSet;
use std::sync::Mutex;

use mainframe_types::acp::extensions::MAINFRAME_META_NAMESPACE;
use mainframe_types::acp::extensions::RevisionCursor as WireRevisionCursor;
use mainframe_types::acp::jsonrpc::{JsonRpcRequest, JsonRpcResponse};
use mainframe_types::acp::session::{ResumeSessionRequest, ResumeSessionResponse};
use mainframe_types::acp::update::{
    IdleStateUpdate, RunningStateUpdate, SessionState as WireSessionState, SessionUpdate,
};
use mainframe_types::adapter::ControlRequest;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::encoder::{self, EncodedItem};
use crate::gates;
use crate::replay_previews;
use crate::revision_log::RevisionLog;
use crate::rpc;
use crate::session_state::SessionState;

pub mod persisted;
mod revision;
mod windowed;

pub use mainframe_types::BoxFuture;

/// The cursor `ResumeSessionRequest.replayFrom` carries — an opaque `Value` on
/// the vendored wire type, so the scheme is defined here. `Start` always
/// full-replays; `Item` resumes after the named stable item; `Revision` names a
/// server-issued epoch/revision boundary, resolved against the chat's
/// `RevisionLog` when the connection opted into revision cursors and the chat
/// has one — otherwise treated the same as an unknown `Item` cursor (a full
/// replay, not a request error).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ReplayCursor {
    Start,
    Item { item_id: String },
    Revision { epoch: String, revision: u64 },
}

/// Shared snapshot of history, streaming overlay, and an open permission gate.
pub use mainframe_types::resume::ResumeSnapshot;

mod port;
pub use port::{ResumePort, SnapshotReader};

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
    /// `items`, grouped back into its per-container shape — the same list
    /// `encoder::encode_containers` produced. `items` stays the flat form
    /// `plan`/`itemCount` use; a container-aware caller (a seeded
    /// `SessionStream`/`RevisionLog`) seeds from this instead of re-flattening.
    pub containers: Vec<Vec<EncodedItem>>,
    /// The tool-call ids this replay sent as result previews — empty unless the
    /// connection opted in. The caller seeds its live diff state with the same
    /// set so later revisions of those items stay trimmed on this connection.
    pub preview_ids: HashSet<String>,
}

/// Per-connection choices a `session/resume` honors.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ResumeOptions {
    /// The connection opted into replay result previews: a full replay sends
    /// tool results older than the newest
    /// [`replay_previews::FULL_RESULT_CONTAINERS`] containers as previews.
    pub result_previews: bool,
    pub windowed_history: bool,
}

pub async fn dispatch_resume(
    request: JsonRpcRequest,
    port: &dyn ResumePort,
    revision_log: Option<(&Mutex<RevisionLog>, WireRevisionCursor)>,
) -> (JsonRpcResponse, ResumeReplay) {
    dispatch_resume_with(request, port, revision_log, ResumeOptions::default()).await
}

/// [`dispatch_resume`] with the connection's negotiated [`ResumeOptions`].
pub async fn dispatch_resume_with(
    request: JsonRpcRequest,
    port: &dyn ResumePort,
    revision_log: Option<(&Mutex<RevisionLog>, WireRevisionCursor)>,
    options: ResumeOptions,
) -> (JsonRpcResponse, ResumeReplay) {
    let id = request.id.clone();
    let resume = match parse_resume_params(request) {
        Ok(resume) => resume,
        Err(response) => return (response, empty_replay()),
    };

    if options.windowed_history && !uses_item_cursor(&resume) {
        return windowed::dispatch(id, resume, port, revision_log, options).await;
    }

    let snapshot = port.resume_snapshot(&resume.session_id).await;
    let containers = encoder::encode_containers(&snapshot.messages, snapshot.streaming);
    let items: Vec<EncodedItem> = containers.iter().flatten().cloned().collect();
    // Only an opted-in connection previews old results, and the set is fixed
    // here so the replay frames and the caller's seeded diff state trim exactly
    // the same ids.
    let preview_ids = if options.result_previews {
        replay_previews::preview_ids(&containers)
    } else {
        HashSet::new()
    };
    let resolved = revision::resolve(
        &items,
        &containers,
        resume.replay_from.as_ref(),
        revision_log,
        &preview_ids,
    );
    let mut updates = resolved.updates;
    updates.push(running_state(port, &resume.session_id));

    let pending_permission_request = snapshot
        .pending
        .as_ref()
        .map(|request| build_pending_permission_request(&resume.session_id, request));
    let response = success_response(
        id,
        items.len(),
        resolved.full_replay,
        resolved.cursor.as_ref(),
    );
    (
        response,
        ResumeReplay {
            updates,
            pending_permission_request,
            pending_gate: snapshot.pending,
            items,
            containers,
            preview_ids,
        },
    )
}

fn uses_item_cursor(resume: &ResumeSessionRequest) -> bool {
    resume
        .replay_from
        .as_ref()
        .and_then(|value| value.get("type"))
        .and_then(Value::as_str)
        == Some("item")
}

fn empty_replay() -> ResumeReplay {
    ResumeReplay {
        updates: Vec::new(),
        pending_permission_request: None,
        pending_gate: None,
        items: Vec::new(),
        containers: Vec::new(),
        preview_ids: HashSet::new(),
    }
}

/// `Err` carries the ready error response — the caller only needs to pair
/// it with an empty replay, never re-derive `id` or the error shape.
fn parse_resume_params(request: JsonRpcRequest) -> Result<ResumeSessionRequest, JsonRpcResponse> {
    let id = request.id;
    let Some(params) = request.params else {
        return Err(rpc::error_response(
            id,
            rpc::invalid_params("session/resume requires params"),
        ));
    };
    serde_json::from_value(params)
        .map_err(|err| rpc::error_response(id, rpc::invalid_params(&err.to_string())))
}

/// The replay's closing `state_update`: `running` carries the daemon's
/// recorded turn start (never a per-connection `now`), `idle` clears it.
fn running_state(port: &dyn ResumePort, session_id: &str) -> SessionUpdate {
    turn_state_update(
        port.is_running(session_id)
            .then(|| RunningStateUpdate::started_at(port.turn_started_at_ms(session_id))),
    )
}

fn turn_state_update(running: Option<RunningStateUpdate>) -> SessionUpdate {
    SessionUpdate::StateUpdate(if let Some(running) = running {
        WireSessionState::Running(running)
    } else {
        WireSessionState::Idle(IdleStateUpdate {
            stop_reason: None,
            meta: None,
        })
    })
}

fn build_pending_permission_request(session_id: &str, request: &ControlRequest) -> JsonRpcRequest {
    gates::build_request(
        session_id,
        gates::gate_request_id(&request.request_id),
        request,
    )
}

fn success_response(
    id: Option<mainframe_types::acp::jsonrpc::RequestId>,
    item_count: usize,
    full_replay: bool,
    cursor: Option<&WireRevisionCursor>,
) -> JsonRpcResponse {
    let response = ResumeSessionResponse {
        config_options: None,
        meta: Some(resume_meta(item_count, full_replay, cursor)),
    };
    let result = serde_json::to_value(response).unwrap_or(Value::Null);
    rpc::success_response(id, result)
}

fn resume_meta(item_count: usize, full_replay: bool, cursor: Option<&WireRevisionCursor>) -> Value {
    let mut ns = serde_json::Map::new();
    ns.insert("itemCount".into(), serde_json::json!(item_count));
    if full_replay {
        ns.insert("fullReplay".into(), Value::Bool(true));
    }
    if let Some(cursor) = cursor {
        ns.insert("cursor".into(), serde_json::json!(cursor));
    }
    serde_json::json!({ MAINFRAME_META_NAMESPACE: ns })
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
        // A revision cursor with no log to resolve it against (the
        // connection never opted in, or `revision.rs` already tried and
        // found none) — treated the same as an unknown item cursor: a full
        // replay, not a request error.
        Ok(ReplayCursor::Revision { .. }) | Err(_) => ResolvedCursor::Unknown,
    }
}

/// Replay via [`SessionState::diff`] against a fresh state: items up to and
/// including the cursor are fed once (seeding them as "already known") and
/// discarded, so the collected diff creates only the items after it — full
/// frames, since a resume has no prior wire state to delta against.
fn replay(
    items: &[EncodedItem],
    resolved: ResolvedCursor,
    previews: &HashSet<String>,
) -> (Vec<SessionUpdate>, bool) {
    let mut state = SessionState::new();
    state.set_previews(previews.clone());
    match resolved {
        ResolvedCursor::Start => (state.diff(items), false),
        ResolvedCursor::Found(cursor_idx) => {
            state.diff(&items[..=cursor_idx]);
            (state.diff(items), false)
        }
        ResolvedCursor::Unknown => (state.diff(items), true),
    }
}

#[cfg(test)]
#[path = "resume_tests.rs"]
mod tests;
