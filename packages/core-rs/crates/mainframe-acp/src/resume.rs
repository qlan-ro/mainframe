//! `session/resume` (todo #350, plan task 15): replay from a cursor over the
//! stable item sequence the canonical encoder produces from history
//! reconstruction — the same ids a live-streamed turn would have used
//! (criterion 4's replay half) — plus redelivery of any still-open
//! permission gate. `ResumePort` mirrors `prompt::PromptPort`'s narrow-seam
//! rationale: `mainframe-chat` is this crate's prospective consumer, not a
//! dependency, so the port stays a plain trait a hand-written fake can
//! implement in tests.

use std::collections::HashSet;
use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex;

use mainframe_types::acp::extensions::MAINFRAME_META_NAMESPACE;
use mainframe_types::acp::extensions::RevisionCursor as WireRevisionCursor;
use mainframe_types::acp::jsonrpc::{JsonRpcRequest, JsonRpcResponse};
use mainframe_types::acp::session::{ResumeSessionRequest, ResumeSessionResponse};
use mainframe_types::acp::update::{
    IdleStateUpdate, SessionState as WireSessionState, SessionUpdate,
};
use mainframe_types::adapter::ControlRequest;
use mainframe_types::display::{DisplayMessage, StreamingLeafKind};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::encoder::{self, EncodedItem};
use crate::gates;
use crate::replay_previews;
use crate::revision_log::RevisionLog;
use crate::rpc;
use crate::session_state::SessionState;

mod revision;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// The cursor `ResumeSessionRequest.replayFrom` carries — an opaque `Value`
/// on the vendored wire type (group A left the scheme to this task).
/// `Start` always full-replays; `Item` resumes after the named stable item;
/// `Revision` (todo #377) names a server-issued epoch/revision boundary,
/// resolved against the chat's `RevisionLog` when the connection opted into
/// revision cursors and the chat has one — otherwise treated the same as an
/// unknown `Item` cursor (edge case 9: a full replay, not a request error).
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

/// `ResumePort::resume_snapshot`'s result (todo #382): display history, the
/// `StreamingLeafKind` of the in-flight partial overlay projected into it
/// (if any — mirrors `mainframe_chat::chat_manager::ResumeSnapshot`, kept as
/// a separate type since this crate depends only on `mainframe-types`, not
/// `mainframe-chat`), and any still-open permission gate.
pub struct ResumeSnapshot {
    pub messages: Vec<DisplayMessage>,
    pub streaming: Option<StreamingLeafKind>,
    pub pending: Option<ControlRequest>,
}

/// The chat-manager surface `session/resume` needs: display history plus any
/// still-open gate for `session_id`, gathered in one call — a production
/// implementation wraps `ChatManager::get_resume_snapshot`.
pub trait ResumePort: Send + Sync {
    fn resume_snapshot<'a>(&'a self, session_id: &'a str) -> BoxFuture<'a, ResumeSnapshot>;

    /// Whether `session_id` has a turn in flight right now — read after the
    /// snapshot so a mid-turn reconnect's replay ends with the state the
    /// client's own UI needs to keep streaming smoothly (R2.4).
    fn is_running(&self, session_id: &str) -> bool;
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
    /// `items`, grouped back into its per-container shape (todo #376 G2
    /// task 5) — the same list `encoder::encode_containers` produced.
    /// `items` stays the flat form `plan`/`itemCount` use; a container-
    /// aware caller (a seeded `SessionStream`/`RevisionLog`, G4) seeds from
    /// this instead of re-flattening.
    pub containers: Vec<Vec<EncodedItem>>,
    /// The tool-call ids this replay sent as result previews (spec Decision
    /// 41) — empty unless the connection opted in. The caller seeds its live
    /// diff state with the same set so later revisions of those items stay
    /// trimmed on this connection.
    pub preview_ids: HashSet<String>,
}

/// Per-connection choices a `session/resume` honors.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ResumeOptions {
    /// The connection opted into replay result previews (spec Decision 41):
    /// a full replay sends tool results older than the newest
    /// [`replay_previews::FULL_RESULT_CONTAINERS`] containers as previews.
    pub result_previews: bool,
}

/// `session/resume` dispatch. Malformed params get the same structured
/// error as every other facade method; a resolved cursor always yields a
/// success response, since "unknown cursor" is itself a defined outcome
/// (full replay with the [`MAINFRAME_META_NAMESPACE`] `fullReplay` marker),
/// not an error (spec edge cases 9).
///
/// `revision_log` (todo #377) is the chat's revision log paired with the
/// boundary the caller captured BEFORE awaiting the snapshot (`None` for a
/// connection that did not opt into revision cursors, which gets byte-
/// identical legacy behavior with no `cursor` meta at all). The caller
/// (`mainframe-server`'s hub, in `begin_resume`) owns the log's lifecycle
/// and that capture; this function only locks the log, after its own
/// snapshot read, to seed an unseeded log and plan against a revision
/// cursor — but the reply's `cursor` always carries the caller's captured
/// boundary, never a fresh `log.boundary()` read here, so it never
/// acknowledges a change recorded in the gap between that capture and this
/// snapshot (`revision::resolve`'s doc has the full race argument).
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

    let snapshot = port.resume_snapshot(&resume.session_id).await;
    // `encode_containers`, not `encode`: a mid-stream snapshot carries the
    // in-flight partial overlay's `StreamingLeafKind` (todo #382) — with
    // `streaming: None` this is byte-identical to `encode`'s output (spec
    // Decision 39). Flattened, it is `encode_revision`'s output (todo #376
    // G2 task 1); `containers` keeps the per-container shape so
    // `revision::resolve` can seed a log's container index too.
    let containers = encoder::encode_containers(&snapshot.messages, snapshot.streaming);
    let items: Vec<EncodedItem> = containers.iter().flatten().cloned().collect();
    // Spec Decision 41: only an opted-in connection previews old results,
    // and the set is fixed here so the replay frames and the caller's seeded
    // diff state trim exactly the same ids.
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
    updates.push(turn_state_update(port.is_running(&resume.session_id)));

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

fn turn_state_update(running: bool) -> SessionUpdate {
    SessionUpdate::StateUpdate(if running {
        WireSessionState::Running
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

/// `itemCount` is the size of the server's full snapshot (not the post-cursor
/// delta): a client holding items can tell an intentionally empty transcript
/// apart from the "no history session yet" degenerate read and refuse the
/// blanking re-seed (the legacy `refusesEmptyRefresh` guard, kept on the
/// facade). `fullReplay` marks an unknown/pre-compaction cursor fallback.
/// `cursor` (todo #377) is present only for a connection that opted into
/// revision cursors — the new replay boundary this reply's updates converge
/// a client to, regardless of which cursor shape the request itself used.
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
        // replay, not a request error (edge case 9).
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
            let _ = state.diff(&items[..=cursor_idx]);
            (state.diff(items), false)
        }
        ResolvedCursor::Unknown => (state.diff(items), true),
    }
}

#[cfg(test)]
mod tests;
