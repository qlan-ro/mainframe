//! Gate-lifecycle cases for `FacadeHub` — raise, resolve, the legacy
//! resolution push, and chat-teardown bookkeeping — split out of
//! `tests.rs` (todo #350, plan task 37, R2.13).

use serde_json::json;

use super::*;

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
