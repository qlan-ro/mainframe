//! Out-of-band notification passthrough cases for `FacadeHub` — retry
//! markers, queue changes, transcript-cleared, compaction, and usage —
//! split out of `tests.rs` (todo #350, plan task 37, R2.13).

use mainframe_chat::chat_surface::CompactionPhase;
use mainframe_types::adapter::ContextUsage;
use serde_json::json;

use super::*;

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
async fn queue_changes_notify_attached_connections_with_the_full_snapshot() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());
    hub.attach(&conn, "chat-1");

    hub.on_chat_surface_event(ChatSurfaceEvent::QueueChanged {
        chat_id: "chat-1".to_string(),
        refs: vec![mainframe_types::chat::QueuedMessageRef {
            message_id: "m1".to_string(),
            chat_id: "chat-1".to_string(),
            uuid: "u1".to_string(),
            content: "queued text".to_string(),
            attachment_ids: None,
            timestamp: "2026-08-29T00:00:00.000Z".to_string(),
        }],
    });
    hub.on_chat_surface_event(ChatSurfaceEvent::QueueChanged {
        chat_id: "chat-2".to_string(),
        refs: Vec::new(),
    });

    let frames = drain(&mut rx);
    assert_eq!(
        frames.len(),
        1,
        "only the attached chat notifies: {frames:?}"
    );
    assert_eq!(frames[0]["method"], json!("_mainframe.dev/queue_state"));
    assert_eq!(frames[0]["params"]["sessionId"], json!("chat-1"));
    assert_eq!(frames[0]["params"]["refs"][0]["uuid"], json!("u1"));
    assert_eq!(
        frames[0]["params"]["refs"][0]["content"],
        json!("queued text")
    );
}

#[tokio::test]
async fn transcript_cleared_notifies_attached_connections() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());
    hub.attach(&conn, "chat-1");

    hub.on_chat_surface_event(ChatSurfaceEvent::TranscriptCleared {
        chat_id: "chat-1".to_string(),
    });
    hub.on_chat_surface_event(ChatSurfaceEvent::TranscriptCleared {
        chat_id: "chat-2".to_string(),
    });

    let frames = drain(&mut rx);
    assert_eq!(
        frames.len(),
        1,
        "only the attached chat notifies: {frames:?}"
    );
    assert_eq!(
        frames[0]["method"],
        json!("_mainframe.dev/transcript_cleared")
    );
    assert_eq!(frames[0]["params"]["sessionId"], json!("chat-1"));
}

#[tokio::test]
async fn compaction_events_notify_attached_connections_with_the_phase() {
    let hub = hub();
    let (_id, conn, mut rx) = hub.register("mock-cli".to_string());
    hub.attach(&conn, "chat-1");

    hub.on_chat_surface_event(ChatSurfaceEvent::Compaction {
        chat_id: "chat-1".to_string(),
        phase: CompactionPhase::Started,
    });
    hub.on_chat_surface_event(ChatSurfaceEvent::Compaction {
        chat_id: "chat-2".to_string(),
        phase: CompactionPhase::Done,
    });

    let frames = drain(&mut rx);
    assert_eq!(
        frames.len(),
        1,
        "only the attached chat notifies: {frames:?}"
    );
    assert_eq!(frames[0]["method"], json!("_mainframe.dev/compaction"));
    assert_eq!(frames[0]["params"]["sessionId"], json!("chat-1"));
    assert_eq!(frames[0]["params"]["phase"], json!("started"));
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
