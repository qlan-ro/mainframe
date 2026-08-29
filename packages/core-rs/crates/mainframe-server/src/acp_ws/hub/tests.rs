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
    }
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
async fn a_raised_gate_is_delivered_to_attached_connections_and_correlatable() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());
    hub.attach(&conn, "chat-1");

    hub.on_chat_surface_event(ChatSurfaceEvent::GateRaised {
        chat_id: "chat-1".to_string(),
        request: control_request("req-9"),
    });

    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0]["method"], json!("session/request_permission"));
    assert_eq!(frames[0]["id"], json!("gate-req-9"));
    assert!(conn.peek_gate("gate-req-9").is_some());

    // Resolution (from any surface) drops the pending entry everywhere.
    hub.on_chat_surface_event(ChatSurfaceEvent::GateResolved {
        chat_id: "chat-1".to_string(),
        request_id: "req-9".to_string(),
    });
    assert!(conn.peek_gate("gate-req-9").is_none());
    assert_eq!(
        hub.claim_gate("chat-1", "req-9"),
        AnswerOutcome::AlreadyResolved,
        "a late answer to the resolved gate must not apply"
    );
}

#[tokio::test]
async fn gate_resolution_is_pushed_to_holders_but_not_to_the_answerer() {
    let hub = hub();
    let (_id_a, conn_a, mut rx_a) = hub.register("mock-cli".to_string());
    let (_id_b, conn_b, mut rx_b) = hub.register("mock-cli".to_string());
    hub.attach(&conn_a, "chat-1");
    hub.attach(&conn_b, "chat-1");
    hub.on_chat_surface_event(ChatSurfaceEvent::GateRaised {
        chat_id: "chat-1".to_string(),
        request: control_request("req-1"),
    });
    drain(&mut rx_a);
    drain(&mut rx_b);

    // The answer path removes its own pending entry before the resolution
    // event fires (dispatch.rs) — mirror that for connection A.
    conn_a.remove_gate("gate-req-1");
    hub.on_chat_surface_event(ChatSurfaceEvent::GateResolved {
        chat_id: "chat-1".to_string(),
        request_id: "req-1".to_string(),
    });

    assert!(
        drain(&mut rx_a).is_empty(),
        "the answerer already knows — no push"
    );
    let frames_b = drain(&mut rx_b);
    assert_eq!(frames_b.len(), 1);
    assert_eq!(frames_b[0]["method"], json!("_mainframe.dev/gate_resolved"));
    assert_eq!(frames_b[0]["params"]["sessionId"], json!("chat-1"));
    assert_eq!(frames_b[0]["params"]["requestId"], json!("gate-req-1"));
    assert!(conn_b.peek_gate("gate-req-1").is_none());
}

#[tokio::test]
async fn a_legacy_surface_resolution_is_pushed_to_every_holder() {
    let hub = hub();
    let (_id_a, conn_a, mut rx_a) = hub.register("mock-cli".to_string());
    let (_id_b, conn_b, mut rx_b) = hub.register("mock-cli".to_string());
    hub.attach(&conn_a, "chat-1");
    hub.attach(&conn_b, "chat-1");
    hub.on_chat_surface_event(ChatSurfaceEvent::GateRaised {
        chat_id: "chat-1".to_string(),
        request: control_request("req-2"),
    });
    drain(&mut rx_a);
    drain(&mut rx_b);

    // A legacy-dialect answer raises GateResolved with no facade claim: every
    // facade connection still holds the gate and every one gets the push.
    hub.on_chat_surface_event(ChatSurfaceEvent::GateResolved {
        chat_id: "chat-1".to_string(),
        request_id: "req-2".to_string(),
    });

    for rx in [&mut rx_a, &mut rx_b] {
        let frames = drain(rx);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0]["method"], json!("_mainframe.dev/gate_resolved"));
        assert_eq!(frames[0]["params"]["requestId"], json!("gate-req-2"));
    }
    assert!(conn_a.peek_gate("gate-req-2").is_none());
    assert!(conn_b.peek_gate("gate-req-2").is_none());
}

#[tokio::test]
async fn chat_ended_drops_gate_bookkeeping_and_per_connection_session_state() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());
    hub.attach(&conn, "chat-1");
    hub.on_chat_surface_event(ChatSurfaceEvent::GateRaised {
        chat_id: "chat-1".to_string(),
        request: control_request("req-3"),
    });
    hub.on_chat_surface_event(ChatSurfaceEvent::GateResolved {
        chat_id: "chat-1".to_string(),
        request_id: "req-3".to_string(),
    });
    hub.on_chat_surface_event(ChatSurfaceEvent::GateRaised {
        chat_id: "chat-1".to_string(),
        request: control_request("req-4"),
    });
    drain(&mut rx);
    assert_eq!(
        hub.claim_gate("chat-1", "req-3"),
        AnswerOutcome::AlreadyResolved
    );

    hub.on_chat_surface_event(ChatSurfaceEvent::ChatEnded {
        chat_id: "chat-1".to_string(),
    });

    assert!(!conn.is_attached("chat-1"), "session state dropped");
    assert!(
        conn.peek_gate("gate-req-4").is_none(),
        "undelivered pending gate dropped"
    );
    assert_eq!(
        hub.claim_gate("chat-1", "req-3"),
        AnswerOutcome::Apply,
        "resolved-id memory dropped with the chat"
    );
}

#[tokio::test]
async fn a_retry_marker_lands_on_the_next_upsert_for_attached_sessions() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());
    hub.attach(&conn, "chat-1");

    hub.on_chat_surface_event(ChatSurfaceEvent::Retry {
        chat_id: "chat-1".to_string(),
        attempt: 1,
        reason: Some("overloaded_error".to_string()),
    });
    hub.on_chat_surface_event(revision("chat-1", "Retried once and completed."));

    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 1);
    // The marker shares the namespace object with the encoder's ItemMeta
    // (timestamp/containerId/…), so assert its keys rather than the whole map.
    let ns = &frames[0]["params"]["update"]["_meta"]["_mainframe.dev"];
    assert_eq!(ns["attempt"], json!(1));
    assert_eq!(ns["reason"], json!("overloaded_error"));
}

#[tokio::test]
async fn usage_events_become_usage_updates() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());
    hub.attach(&conn, "chat-1");

    hub.on_chat_surface_event(ChatSurfaceEvent::Usage {
        chat_id: "chat-1".to_string(),
        usage: ContextUsage {
            percentage: 1.5,
            total_tokens: 3_000,
            max_tokens: 200_000,
        },
    });

    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 1);
    assert_eq!(
        frames[0]["params"]["update"]["sessionUpdate"],
        json!("usage_update")
    );
    assert_eq!(frames[0]["params"]["update"]["used"], json!(3_000));
    assert_eq!(frames[0]["params"]["update"]["size"], json!(200_000));
    // The CLI's own percentage rides the extension namespace — it is not
    // derivable from used/size (usable-window buffer).
    assert_eq!(
        frames[0]["params"]["update"]["_meta"]["_mainframe.dev"]["percentage"],
        json!(1.5)
    );
}

#[tokio::test]
async fn reset_session_seeds_replayed_state_so_live_updates_continue_as_deltas() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());

    let items = mainframe_acp::encode(&[display_message("m1", "Hello")]);
    hub.reset_session(&conn, "chat-1", &items, |c| {
        c.send_update(
            "chat-1",
            mainframe_types::acp::update::SessionUpdate::StateUpdate(
                mainframe_types::acp::update::SessionState::Running,
            ),
        );
    });

    // The delivery closure ran inside the reset.
    assert_eq!(drain(&mut rx).len(), 1);

    // A live revision after the seed emits only the suffix.
    hub.on_chat_surface_event(revision("chat-1", "Hello world"));
    let frames = drain(&mut rx);
    assert_eq!(frames.len(), 1);
    assert_eq!(
        frames[0]["params"]["update"]["sessionUpdate"],
        json!("agent_message_chunk")
    );
    assert_eq!(
        frames[0]["params"]["update"]["content"]["text"],
        json!(" world")
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
