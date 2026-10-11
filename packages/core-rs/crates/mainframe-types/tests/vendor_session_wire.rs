#![allow(clippy::unwrap_used, clippy::expect_used)]
use mainframe_types::{chat_patch::ChatPatch, events::DaemonEvent};
use serde_json::json;

#[test]
fn provider_neutral_fields_keep_the_existing_wire_name() {
    let patch = ChatPatch {
        vendor_session_id: Some("session-1".into()),
        ..Default::default()
    };
    let value = serde_json::to_value(&patch).unwrap();
    assert_eq!(value["claudeSessionId"], "session-1");
    assert!(value.get("vendorSessionId").is_none());
    assert_eq!(
        serde_json::from_value::<ChatPatch>(value)
            .unwrap()
            .vendor_session_id
            .as_deref(),
        Some("session-1")
    );
    let event = DaemonEvent::ProcessReady {
        process_id: "p".into(),
        vendor_session_id: "session-1".into(),
    };
    assert_eq!(
        serde_json::to_value(event).unwrap(),
        json!({"type":"process.ready","processId":"p","claudeSessionId":"session-1"})
    );
}
