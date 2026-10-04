//! Mainframe's `_mainframe.dev` capability advertisement, riding
//! `initialize`'s response `_meta` (todo #350, plan task 8), plus the
//! `_mainframe.dev/heartbeat` notification builder (task 9). Every value is
//! fixture-pinned in `mainframe-types`' `extensions.capabilities.json` /
//! `initialize.response.json` / `heartbeat.notification.json` — this module
//! only assembles them.

use mainframe_types::acp::extensions::{
    COMPRESSED_REPLAY_OPT_IN_KEY, CompactionParams, CompactionWirePhase, CursorParams,
    GateResolvedParams, HeartbeatParams, MAINFRAME_META_NAMESPACE, MainframeCapabilities,
    QueueStateParams, REPLAY_RESULT_PREVIEWS_OPT_IN_KEY, REVISION_CURSORS_OPT_IN_KEY,
    ReplayCompleteParams, ResyncParams, RevisionCursor, TranscriptClearedParams,
};
use mainframe_types::acp::jsonrpc::JsonRpcNotification;
use mainframe_types::chat::QueuedMessageRef;
use serde_json::Value;

/// Production default heartbeat cadence, matching the vendored fixtures
/// (`heartbeat.notification.json`'s sibling `initialize.response.json`
/// advertises `heartbeatIntervalMs: 15000`). Callers that need a tighter
/// cadence (integration tests) configure it explicitly rather than relying
/// on this constant.
pub const DEFAULT_HEARTBEAT_INTERVAL_MS: u64 = 15_000;

/// The daemon's `_mainframe.dev` capability set, parameterized on the
/// heartbeat cadence actually in force so a shortened test cadence is
/// truthfully advertised rather than echoing the production constant.
pub fn mainframe_capabilities(heartbeat_interval_ms: u64) -> MainframeCapabilities {
    MainframeCapabilities {
        rich_permission_answers: Some(true),
        queued_prompts: Some(true),
        retry_markers: Some(true),
        heartbeat_interval_ms: Some(heartbeat_interval_ms as i64),
        item_creation_markers: Some(true),
        replay_complete: Some(true),
        authoritative_item_streaming: Some(true),
        // The daemon side landed (todo #377, group G2): a connection that
        // opts in via `REVISION_CURSORS_OPT_IN_KEY` gets cursor meta and
        // `_mainframe.dev/cursor` notifications; one that does not keeps
        // today's item-cursor-only wire regardless of this flag.
        revision_cursors: Some(true),
        // Spec Decision 41: a connection that opts in via
        // `REPLAY_RESULT_PREVIEWS_OPT_IN_KEY` gets old tool results as
        // previews on a full replay; one that does not keeps full results.
        replay_result_previews: Some(true),
        // Spec Decision 42: a connection that opts in via
        // `COMPRESSED_REPLAY_OPT_IN_KEY` gets its resume replays as
        // `_mainframe.dev/replay_batch` frames; one that does not keeps the
        // per-update replay.
        compressed_replay: Some(true),
    }
}

/// Whether an `initialize` request opts into revision-versioned resume
/// cursors (todo #377): `params._meta["_mainframe.dev"].revisionCursors ==
/// true`. Reads the raw request params directly, ahead of
/// `InitializeRequest` deserialization succeeding or the handshake
/// negotiating — `mainframe-server`'s `dispatch_fallback` calls this on the
/// still-owned frame before handing it to `dispatch_with_prompt`, and only
/// acts on the result once that call reports the handshake negotiated.
pub fn client_opts_into_revision_cursors(params: Option<&Value>) -> bool {
    client_opt_in(params, REVISION_CURSORS_OPT_IN_KEY)
}

/// Whether an `initialize` request opted into replay result previews (spec
/// Decision 41): `params._meta["_mainframe.dev"].replayResultPreviews == true`.
pub fn client_opts_into_replay_result_previews(params: Option<&Value>) -> bool {
    client_opt_in(params, REPLAY_RESULT_PREVIEWS_OPT_IN_KEY)
}

/// Whether an `initialize` request opted into compressed replay batches
/// (spec Decision 42): `params._meta["_mainframe.dev"].compressedReplay == true`.
pub fn client_opts_into_compressed_replay(params: Option<&Value>) -> bool {
    client_opt_in(params, COMPRESSED_REPLAY_OPT_IN_KEY)
}

/// A boolean `_meta["_mainframe.dev"]` opt-in on an `initialize` request —
/// absent, non-boolean, or `false` all read as not opted in.
fn client_opt_in(params: Option<&Value>, key: &str) -> bool {
    params
        .and_then(|params| params.get("_meta"))
        .and_then(|meta| meta.get(MAINFRAME_META_NAMESPACE))
        .and_then(|ns| ns.get(key))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// The `_mainframe.dev/cursor` notification (todo #377): the replay boundary
/// a reconnecting client now holds every change through — rides the
/// per-session throttle FIFO after the frames of the display revision it
/// describes (`ThrottledFrame::Cursor`), and is built only for a connection
/// that opted in.
pub fn cursor_notification(session_id: &str, cursor: &RevisionCursor) -> JsonRpcNotification {
    JsonRpcNotification {
        jsonrpc: "2.0".into(),
        method: "_mainframe.dev/cursor".into(),
        params: Some(serde_json::json!(CursorParams {
            session_id: session_id.to_string(),
            epoch: cursor.epoch.clone(),
            revision: cursor.revision,
        })),
    }
}

/// The `_mainframe.dev/heartbeat` notification (plan task 9): `sequence` lets
/// a client detect a gap (a jump larger than one) and resume instead of
/// heuristically refetching (spec decision 13).
pub fn heartbeat_notification(sequence: u64) -> JsonRpcNotification {
    JsonRpcNotification {
        jsonrpc: "2.0".into(),
        method: "_mainframe.dev/heartbeat".into(),
        params: Some(serde_json::json!(HeartbeatParams { sequence })),
    }
}

/// The `_mainframe.dev/gate_resolved` notification (spec decision 19): sent
/// to every attached connection still holding a pending gate when it resolves
/// elsewhere, so the client clears it immediately instead of on its next
/// resume. `rpc_id` is the string form of the gate's `session/request_permission`
/// JSON-RPC id (`gate-{requestId}`) — exactly what the client keyed the
/// pending gate under.
pub fn gate_resolved_notification(session_id: &str, rpc_id: &str) -> JsonRpcNotification {
    JsonRpcNotification {
        jsonrpc: "2.0".into(),
        method: "_mainframe.dev/gate_resolved".into(),
        params: Some(serde_json::json!(GateResolvedParams {
            session_id: session_id.to_string(),
            request_id: rpc_id.to_string(),
        })),
    }
}

/// The `_mainframe.dev/compaction` notification: live compaction progress
/// (`started`/`done`) for every connection attached to the session — the
/// facade successor to the legacy `chat.compacting`/`chat.compactDone` pair.
pub fn compaction_notification(
    session_id: &str,
    phase: CompactionWirePhase,
) -> JsonRpcNotification {
    JsonRpcNotification {
        jsonrpc: "2.0".into(),
        method: "_mainframe.dev/compaction".into(),
        params: Some(serde_json::json!(CompactionParams {
            session_id: session_id.to_string(),
            phase,
        })),
    }
}

/// The `_mainframe.dev/transcript_cleared` notification: the server wiped
/// the session's transcript (plan-mode clear-context); attached clients
/// re-resume to converge — the facade successor to `messages.cleared`.
pub fn transcript_cleared_notification(session_id: &str) -> JsonRpcNotification {
    JsonRpcNotification {
        jsonrpc: "2.0".into(),
        method: "_mainframe.dev/transcript_cleared".into(),
        params: Some(serde_json::json!(TranscriptClearedParams {
            session_id: session_id.to_string(),
        })),
    }
}

/// The `_mainframe.dev/queue_state` notification: the session's full
/// queued-prompt snapshot, pushed on every queue change and after a resume
/// (sent even when empty, so a reconnect clears stale queued turns).
pub fn queue_state_notification(
    session_id: &str,
    refs: Vec<QueuedMessageRef>,
) -> JsonRpcNotification {
    JsonRpcNotification {
        jsonrpc: "2.0".into(),
        method: "_mainframe.dev/queue_state".into(),
        params: Some(serde_json::json!(QueueStateParams {
            session_id: session_id.to_string(),
            refs,
        })),
    }
}

/// The `_mainframe.dev/resync` notification (spec Decision 34, rewritten):
/// the daemon's view of the chat diverged from what an attached client may
/// hold — `do_load_chat` rebuilt the cache from the transcript and the
/// result changed, or a resume delivery failed after its reply — so the
/// client re-resumes, with no reducer wipe, unlike `transcript_cleared`.
/// Cache retention alone never raises it.
pub fn resync_notification(session_id: &str) -> JsonRpcNotification {
    JsonRpcNotification {
        jsonrpc: "2.0".into(),
        method: "_mainframe.dev/resync".into(),
        params: Some(serde_json::json!(ResyncParams {
            session_id: session_id.to_string(),
        })),
    }
}

/// The `_mainframe.dev/replay_complete` notification (spec Decision 38):
/// closes exactly one `session/resume` replay, sent after `queue_state` and
/// before the buffered catch-up in every arm that sent a successful reply.
/// `aborted` carries `true` only when a resume delivery failed after its
/// reply went out; a normal close omits the key entirely.
pub fn replay_complete_notification(session_id: &str, aborted: bool) -> JsonRpcNotification {
    JsonRpcNotification {
        jsonrpc: "2.0".into(),
        method: "_mainframe.dev/replay_complete".into(),
        params: Some(serde_json::json!(ReplayCompleteParams {
            session_id: session_id.to_string(),
            aborted: aborted.then_some(true),
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_pinned_fixture_shape() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../mainframe-types/tests/fixtures/acp/extensions.capabilities.json"
        ))
        .unwrap();
        let caps = mainframe_capabilities(DEFAULT_HEARTBEAT_INTERVAL_MS);
        let value = serde_json::to_value(caps).unwrap();

        assert_eq!(
            value["richPermissionAnswers"],
            fixture["richPermissionAnswers"]
        );
        assert_eq!(value["queuedPrompts"], fixture["queuedPrompts"]);
        assert_eq!(value["retryMarkers"], fixture["retryMarkers"]);
        assert_eq!(value["heartbeatIntervalMs"], fixture["heartbeatIntervalMs"]);
        assert_eq!(value["itemCreationMarkers"], fixture["itemCreationMarkers"]);
        assert_eq!(value["replayComplete"], fixture["replayComplete"]);
        assert_eq!(value["authoritativeItemStreaming"], serde_json::json!(true));
        assert_eq!(
            value["authoritativeItemStreaming"],
            fixture["authoritativeItemStreaming"]
        );
        assert_eq!(value["revisionCursors"], fixture["revisionCursors"]);
    }

    #[test]
    fn client_opts_into_revision_cursors_reads_the_meta_namespace() {
        let opted_in = serde_json::json!({
            "_meta": { "_mainframe.dev": { "revisionCursors": true } }
        });
        assert!(client_opts_into_revision_cursors(Some(&opted_in)));

        let opted_out = serde_json::json!({ "_meta": { "_mainframe.dev": {} } });
        assert!(!client_opts_into_revision_cursors(Some(&opted_out)));

        assert!(!client_opts_into_revision_cursors(None));
    }

    #[test]
    fn cursor_notification_matches_the_pinned_fixture() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../mainframe-types/tests/fixtures/acp/cursor.notification.json"
        ))
        .unwrap();
        let note = cursor_notification(
            "chat_9f2a3b1c",
            &mainframe_types::acp::extensions::RevisionCursor {
                epoch: "ep_4b7f9c21".to_string(),
                revision: 42,
            },
        );
        let mut value = serde_json::to_value(&note).unwrap();
        value["_provenance"] = fixture["_provenance"].clone();
        assert_eq!(value, fixture);
    }

    #[test]
    fn replay_complete_matches_the_pinned_fixture() {
        let normal_fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../mainframe-types/tests/fixtures/acp/replay-complete.notification.json"
        ))
        .unwrap();
        let normal = replay_complete_notification("chat_1", false);
        let mut normal_value = serde_json::to_value(&normal).unwrap();
        normal_value["_provenance"] = normal_fixture["_provenance"].clone();
        assert_eq!(normal_value, normal_fixture);

        let aborted_fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../mainframe-types/tests/fixtures/acp/replay-complete.params-aborted.json"
        ))
        .unwrap();
        let aborted = replay_complete_notification("chat_1", true);
        let mut aborted_params = serde_json::to_value(&aborted).unwrap()["params"].clone();
        aborted_params["_provenance"] = aborted_fixture["_provenance"].clone();
        assert_eq!(aborted_params, aborted_fixture);
    }

    #[test]
    fn heartbeat_notification_matches_the_pinned_method_name() {
        let note = heartbeat_notification(42);
        let value = serde_json::to_value(&note).unwrap();
        assert_eq!(value["method"], "_mainframe.dev/heartbeat");
        assert_eq!(value["params"]["sequence"], serde_json::json!(42));
    }

    #[test]
    fn gate_resolved_notification_matches_the_pinned_fixture_shape() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../mainframe-types/tests/fixtures/acp/gate-resolved.notification.json"
        ))
        .unwrap();
        let note = gate_resolved_notification("chat_1", "gate-req_1");
        let mut value = serde_json::to_value(&note).unwrap();
        value["_provenance"] = fixture["_provenance"].clone();
        assert_eq!(value, fixture);
    }
}
