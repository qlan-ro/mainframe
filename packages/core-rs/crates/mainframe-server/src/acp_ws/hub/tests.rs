//! Basic fan-out, gate, and lifecycle characterization for `FacadeHub`.
//! Gate-lifecycle cases moved to `gate_tests.rs`, out-of-band notification
//! passthrough to `notification_tests.rs`, and resume/reset-session race
//! cases to `resume_race_tests.rs` (todo #350, plan task 37, R2.13) — all
//! three share this file's fixture builders via `use super::*`.

mod awaiting_seed_tests;
mod gate_tests;
mod notification_tests;
mod resume_race_tests;

use mainframe_chat::chat_surface::{ChatSurfaceEvent, TurnStopReason};
use mainframe_types::adapter::ControlRequest;
use mainframe_types::content::LeafContent;
use mainframe_types::display::{DisplayContent, DisplayMessage, DisplayMessageType};
use serde_json::{Value, json};
use tokio::sync::mpsc;

use super::*;

fn hub() -> FacadeHub {
    // Interval 0: every push is due, so tests observe frames without a tick.
    FacadeHub::new(0)
}

fn display_message(id: &str, text: &str) -> DisplayMessage {
    DisplayMessage {
        id: id.to_string(),
        chat_id: "chat-1".to_string(),
        r#type: DisplayMessageType::Assistant,
        content: vec![DisplayContent::Leaf(LeafContent::Text {
            text: text.to_string(),
            parent_tool_use_id: None,
        })],
        timestamp: "2026-08-28T00:00:00.000Z".to_string(),
        metadata: None,
    }
}

fn revision(chat_id: &str, text: &str) -> ChatSurfaceEvent {
    ChatSurfaceEvent::DisplayRevision {
        chat_id: chat_id.to_string(),
        messages: vec![display_message("m1", text)],
    }
}

fn control_request(request_id: &str) -> ControlRequest {
    ControlRequest {
        request_id: request_id.to_string(),
        tool_use_id: "tool-1".to_string(),
        tool_name: "Bash".to_string(),
        input: Default::default(),
        suggestions: Vec::new(),
        decision_reason: None,
        options: None,
    }
}

/// The `session/resume` reply `reset_session` sends ahead of the replay.
fn reply(id: i64) -> mainframe_types::acp::jsonrpc::JsonRpcResponse {
    mainframe_acp::rpc::success_response(
        Some(mainframe_types::acp::jsonrpc::RequestId::Number(id)),
        json!({}),
    )
}

/// The common `ResumeSeed`: a snapshot and its reply, with no gate the
/// replay redelivers.
fn seed<'a>(items: &'a [EncodedItem], reply: &'a JsonRpcResponse) -> ResumeSeed<'a> {
    ResumeSeed {
        items,
        reply,
        redelivered_gate: None,
    }
}

/// One `session/update` sent from inside a replay closure, standing in for
/// the transcript a real resume replays.
fn replay_marker(conn: &crate::acp_ws::facade_conn::FacadeConnection) {
    conn.send_update(
        "chat-1",
        mainframe_types::acp::update::SessionUpdate::StateUpdate(
            mainframe_types::acp::update::SessionState::Running,
        ),
    );
}

fn drain(rx: &mut mpsc::UnboundedReceiver<String>) -> Vec<Value> {
    let mut frames = Vec::new();
    while let Ok(payload) = rx.try_recv() {
        frames.push(serde_json::from_str(&payload).expect("outbound frames are JSON"));
    }
    frames
}

#[tokio::test]
async fn events_reach_only_connections_attached_to_the_chat() {
    let hub = hub();
    let (_id_a, conn_a, mut rx_a) = hub.register("mock-cli".to_string());
    let (_id_b, _conn_b, mut rx_b) = hub.register("mock-cli".to_string());
    hub.attach(&conn_a, "chat-1");

    hub.on_chat_surface_event(revision("chat-1", "Hello"));

    let frames_a = drain(&mut rx_a);
    assert_eq!(frames_a.len(), 1);
    assert_eq!(frames_a[0]["method"], json!("session/update"));
    assert_eq!(frames_a[0]["params"]["sessionId"], json!("chat-1"));
    assert_eq!(
        frames_a[0]["params"]["update"]["sessionUpdate"],
        json!("agent_message")
    );
    assert!(
        drain(&mut rx_b).is_empty(),
        "unattached connection stays silent"
    );
}

#[tokio::test]
async fn a_growing_message_streams_as_chunks_after_its_first_frame() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());
    hub.attach(&conn, "chat-1");

    hub.on_chat_surface_event(revision("chat-1", "Hel"));
    hub.on_chat_surface_event(revision("chat-1", "Hello"));

    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 2);
    assert_eq!(
        frames[1]["params"]["update"]["sessionUpdate"],
        json!("agent_message_chunk")
    );
    assert_eq!(
        frames[1]["params"]["update"]["content"]["text"],
        json!("lo")
    );
}

#[tokio::test]
async fn turn_lifecycle_maps_to_state_updates_with_stop_reasons() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());
    hub.attach(&conn, "chat-1");

    hub.on_chat_surface_event(ChatSurfaceEvent::TurnStarted {
        chat_id: "chat-1".to_string(),
    });
    hub.on_chat_surface_event(ChatSurfaceEvent::TurnFinished {
        chat_id: "chat-1".to_string(),
        stop_reason: TurnStopReason::Cancelled,
    });

    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 2);
    assert_eq!(frames[0]["params"]["update"]["state"], json!("running"));
    assert_eq!(frames[1]["params"]["update"]["state"], json!("idle"));
    assert_eq!(
        frames[1]["params"]["update"]["stopReason"],
        json!("cancelled")
    );
}

#[tokio::test]
async fn unregister_stops_fan_out_and_updates_the_count() {
    let hub = hub();
    let (id, conn, mut rx) = hub.register("mock-cli".to_string());
    hub.attach(&conn, "chat-1");
    assert_eq!(hub.connection_count(), 1);

    hub.unregister(&id);
    assert_eq!(hub.connection_count(), 0);
    hub.on_chat_surface_event(revision("chat-1", "Hello"));
    assert!(drain(&mut rx).is_empty());
}
