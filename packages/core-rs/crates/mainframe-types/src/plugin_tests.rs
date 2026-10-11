use super::*;

#[test]
fn capability_renames() {
    assert_eq!(
        serde_json::to_string(&PluginCapability::DaemonPublicEvents).unwrap(),
        "\"daemon:public-events\""
    );
    assert_eq!(
        serde_json::to_string(&PluginCapability::ChatReadContent).unwrap(),
        "\"chat:read:content\""
    );
}

#[test]
fn zone_id_kebab() {
    assert_eq!(
        serde_json::to_string(&ZoneId::BottomLeft).unwrap(),
        "\"bottom-left\""
    );
}

#[test]
fn manifest_ui_accepts_single_and_array() {
    let single = r#"{"zone":"left-top","label":"Files"}"#;
    let ui: PluginManifestUi = serde_json::from_str(single).unwrap();
    assert!(matches!(ui, PluginManifestUi::Single(_)));

    let multi = r#"[{"zone":"left-top","label":"Files"},{"zone":"fullview","label":"Board"}]"#;
    let ui: PluginManifestUi = serde_json::from_str(multi).unwrap();
    assert!(matches!(ui, PluginManifestUi::Multi(_)));
}

#[test]
fn public_daemon_event_completed_tagged() {
    let json = r#"{"type":"chat.completed","chatId":"c1","projectId":"p1","cost":0.0842,"durationMs":1200}"#;
    let e: PublicDaemonEvent = serde_json::from_str(json).unwrap();
    assert!(matches!(e, PublicDaemonEvent::ChatCompleted { .. }));
    assert_eq!(serde_json::to_string(&e).unwrap(), json);
}

#[test]
fn chat_event_message_added_carries_chat_message() {
    let json = r#"{"type":"message.added","chatId":"c1","message":{"id":"m1","chatId":"c1","type":"user","content":[],"timestamp":"2026-07-08T00:00:00.000Z"}}"#;
    let e: ChatEvent = serde_json::from_str(json).unwrap();
    assert!(matches!(e, ChatEvent::MessageAdded { .. }));
    assert_eq!(serde_json::to_string(&e).unwrap(), json);
}

#[test]
fn chat_event_tool_called_tagged() {
    let json = r#"{"type":"tool.called","chatId":"c1","toolName":"Bash","args":{"command":"ls"}}"#;
    let e: ChatEvent = serde_json::from_str(json).unwrap();
    assert!(matches!(e, ChatEvent::ToolCalled { .. }));
    assert_eq!(serde_json::to_string(&e).unwrap(), json);
}

#[test]
fn chat_summary_serializes_null_title() {
    let json = r#"{"id":"c1","title":null,"projectId":"p1","adapterId":"claude","createdAt":"2026-07-08T00:00:00Z","totalCost":0.0}"#;
    let s: ChatSummary = serde_json::from_str(json).unwrap();
    assert!(s.title.is_none());
    assert_eq!(serde_json::to_string(&s).unwrap(), json);
}
