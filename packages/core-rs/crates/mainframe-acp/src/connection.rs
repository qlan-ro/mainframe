//! Per-frame ACP facade dispatch (todo #350, plan tasks 8 + 14): a pure
//! function from one WS text frame to the reply (if any) to write back.
//! Parameterized on `DaemonInfo` and a [`PromptPort`] rather than reading any
//! daemon state directly, so this stays unit-testable without a socket —
//! `mainframe-server`'s `acp_ws` module is the axum shell that owns the
//! socket loop, peels off the stateful methods (`session/resume`, gate-answer
//! responses), and routes every remaining frame through
//! [`dispatch_with_prompt`].

use mainframe_types::acp::extensions::MAINFRAME_META_NAMESPACE;
use mainframe_types::acp::jsonrpc::{
    JsonRpcErrorObject, JsonRpcOutcome, JsonRpcRequest, JsonRpcResponse, RequestId, error_codes,
};
use mainframe_types::acp::session::{
    Implementation, InitializeRequest, InitializeResponse, PINNED_PROTOCOL_VERSION,
};
use serde_json::{Value, json};

use crate::capabilities::mainframe_capabilities;
use crate::prompt::{self, PromptPort};
use crate::rpc::{self, InboundFrame};

/// The daemon identity and configured heartbeat cadence threaded in from
/// `AppCtx` — the only state `initialize`'s response needs. `Clone` so a
/// spawned prompt task (T10) can own its copy.
#[derive(Clone)]
pub struct DaemonInfo {
    pub version: String,
    pub heartbeat_interval_ms: u64,
}

/// What one dispatched frame produced: the JSON to write back (if any), and
/// whether the frame completed the handshake. Only the dispatcher knows an
/// `initialize` succeeded, so the socket shell reads it from here instead of
/// re-parsing the reply it is about to send.
pub struct DispatchOutcome {
    pub reply: Option<String>,
    pub negotiated: bool,
}

impl DispatchOutcome {
    /// A frame that gets no reply: a notification, or a response to one of
    /// the daemon's own requests.
    fn silent() -> Self {
        Self {
            reply: None,
            negotiated: false,
        }
    }

    fn answered(wire: String) -> Self {
        Self {
            reply: Some(wire),
            negotiated: false,
        }
    }
}

/// Handle one inbound WS text frame, with `session/prompt`/`session/cancel`
/// routed through a [`PromptPort`] (plan task 14). `Some` is the JSON to
/// write back; notifications and daemon-initiated-request responses never get
/// one, per JSON-RPC 2.0 (even when the notification names an unknown method
/// — a notification's sender does not expect an answer to be listening for).
/// Callers that track negotiation across frames want
/// [`dispatch_with_prompt`]'s full [`DispatchOutcome`] instead.
pub async fn handle_frame_with_prompt(
    text: &str,
    daemon: &DaemonInfo,
    port: &dyn PromptPort,
    negotiated: bool,
) -> Option<String> {
    match rpc::parse_frame(text) {
        Ok(frame) => {
            dispatch_with_prompt(frame, daemon, port, negotiated)
                .await
                .reply
        }
        Err(error) => Some(to_wire(&rpc::error_response(None, error))),
    }
}

/// The parsed-frame half of [`handle_frame_with_prompt`], for callers that
/// classify the frame themselves first — the live socket loop
/// (`mainframe-server`'s `acp_ws`) peels off `session/resume` and gate-answer
/// responses before falling through to this dispatcher, and must not pay (or
/// diverge on) a second parse.
///
/// `negotiated` gates every method but `initialize` (R3.21, spec 32): the
/// handshake is load-bearing, not advisory — a peer that never negotiated (or
/// negotiated an unsupported version) cannot prompt, resume, or cancel.
pub async fn dispatch_with_prompt(
    frame: InboundFrame,
    daemon: &DaemonInfo,
    port: &dyn PromptPort,
    negotiated: bool,
) -> DispatchOutcome {
    if !negotiated && !is_initialize(&frame) {
        return DispatchOutcome {
            reply: refuse_before_initialize(&frame),
            negotiated: false,
        };
    }
    match frame {
        InboundFrame::Request(request) if request.method == "session/prompt" => {
            DispatchOutcome::answered(to_wire(&prompt::dispatch_prompt(request, port).await))
        }
        InboundFrame::Notification(note) if note.method == "session/cancel" => {
            prompt::dispatch_cancel(note.params, port).await;
            DispatchOutcome::silent()
        }
        InboundFrame::Request(request) => {
            let completes_handshake = request.method == "initialize";
            let response = dispatch_request(request, daemon);
            let succeeded = matches!(response.outcome, JsonRpcOutcome::Result { .. });
            DispatchOutcome {
                reply: Some(to_wire(&response)),
                negotiated: completes_handshake && succeeded,
            }
        }
        InboundFrame::Notification(_) | InboundFrame::Response(_) => DispatchOutcome::silent(),
    }
}

fn is_initialize(frame: &InboundFrame) -> bool {
    matches!(frame, InboundFrame::Request(request) if request.method == "initialize")
}

/// A notification gets no reply either way (JSON-RPC 2.0); a request gets
/// the structured refusal, correlated to its own id.
fn refuse_before_initialize(frame: &InboundFrame) -> Option<String> {
    match frame {
        InboundFrame::Request(request) => Some(to_wire(&rpc::error_response(
            request.id.clone(),
            initialize_required(),
        ))),
        InboundFrame::Notification(_) | InboundFrame::Response(_) => None,
    }
}

/// The structured refusal every method but `initialize` gets before the
/// handshake completes (R3.21) — `mainframe-server` reuses it for
/// `session/resume`, which it peels off before this dispatcher ever sees it.
pub fn initialize_required() -> JsonRpcErrorObject {
    JsonRpcErrorObject {
        code: error_codes::RESOURCE_NOT_FOUND,
        message: "initialize required".into(),
        data: None,
    }
}

fn dispatch_request(request: JsonRpcRequest, daemon: &DaemonInfo) -> JsonRpcResponse {
    match request.method.as_str() {
        "initialize" => handle_initialize(request.id, request.params, daemon),
        other => rpc::error_response(request.id, rpc::method_not_found(other)),
    }
}

/// Negotiate the pinned protocol version and advertise `_mainframe.dev`
/// capabilities. An unsupported `protocolVersion` gets the structured
/// `UNSUPPORTED_PROTOCOL_VERSION` error — the connection stays open; only the
/// caller's socket loop decides whether to close, and this function never
/// does.
fn handle_initialize(
    id: Option<RequestId>,
    params: Option<Value>,
    daemon: &DaemonInfo,
) -> JsonRpcResponse {
    let Some(params) = params else {
        return rpc::error_response(id, rpc::invalid_params("initialize requires params"));
    };
    let request: InitializeRequest = match serde_json::from_value(params) {
        Ok(request) => request,
        Err(err) => return rpc::error_response(id, rpc::invalid_params(&err.to_string())),
    };
    if request.protocol_version != PINNED_PROTOCOL_VERSION {
        return rpc::error_response(id, unsupported_protocol_version());
    }

    let response = InitializeResponse {
        protocol_version: PINNED_PROTOCOL_VERSION,
        info: Implementation {
            name: "mainframe-daemon".into(),
            title: None,
            version: daemon.version.clone(),
        },
        capabilities: Some(json!({ "session": {} })),
        auth_methods: None,
        meta: Some(json!({
            MAINFRAME_META_NAMESPACE: mainframe_capabilities(daemon.heartbeat_interval_ms),
        })),
    };
    let result = serde_json::to_value(response).unwrap_or(Value::Null);
    rpc::success_response(id, result)
}

/// Mainframe-specific: not an ACP-defined code (see `error_codes` doc comment
/// in `mainframe_types::acp::jsonrpc`), reserved-range per the schema's
/// protocol-specific-code guidance. `data.supported` lists every protocol
/// version this daemon negotiates — today, just the one pinned snapshot.
fn unsupported_protocol_version() -> JsonRpcErrorObject {
    JsonRpcErrorObject {
        code: error_codes::UNSUPPORTED_PROTOCOL_VERSION,
        message: "unsupported protocol version".into(),
        data: Some(json!({ "supported": [PINNED_PROTOCOL_VERSION] })),
    }
}

fn to_wire(response: &JsonRpcResponse) -> String {
    serde_json::to_string(response).unwrap_or_else(|_| {
        r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"internal error"}}"#.into()
    })
}

#[cfg(test)]
mod tests;
