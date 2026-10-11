#[test]
fn notification_created_wire_shape_omits_absent_links() {
    assert_daemon_wire(
        DaemonEvent::NotificationCreated {
            title: "#12 lane".into(),
            body: "→ pipeline:qa".into(),
            links: None,
        },
        json!({
            "type": "notification.created",
            "title": "#12 lane",
            "body": "→ pipeline:qa"
        }),
    );
}

#[test]
fn notification_created_wire_shape_with_links() {
    assert_daemon_wire(
        DaemonEvent::NotificationCreated {
            title: "#12 lane".into(),
            body: "→ pipeline:qa".into(),
            links: Some(NotificationLinks {
                chat_ids: vec!["chat_1".into()],
            }),
        },
        json!({
            "type": "notification.created",
            "title": "#12 lane",
            "body": "→ pipeline:qa",
            "links": { "chatIds": ["chat_1"] }
        }),
    );
}

#[test]
fn chat_notification_kind_wire_shape() {
    assert_daemon_wire(
        DaemonEvent::ChatNotification {
            chat_id: "chat_1".into(),
            title: "Claude needs your attention".into(),
            body: "Ready to deploy?".into(),
            level: ChatNotificationLevel::Success,
            kind: Some(ChatNotificationKind::AttentionRequest),
        },
        json!({
            "type": "chat.notification",
            "chatId": "chat_1",
            "title": "Claude needs your attention",
            "body": "Ready to deploy?",
            "level": "success",
            "kind": "attention_request"
        }),
    );
    assert_daemon_wire(
        DaemonEvent::ChatNotification {
            chat_id: "chat_1".into(),
            title: "Task Complete".into(),
            body: "done".into(),
            level: ChatNotificationLevel::Success,
            kind: None,
        },
        json!({
            "type": "chat.notification",
            "chatId": "chat_1",
            "title": "Task Complete",
            "body": "done",
            "level": "success"
        }),
    );
}

#[test]
fn client_subscribe_and_file() {
    assert_client_roundtrip(json!({ "type": "subscribe", "chatId": "chat_1" }));
    assert_client_roundtrip(json!({ "type": "unsubscribe", "chatId": "chat_1" }));
    assert_client_roundtrip(json!({ "type": "subscribe:file", "path": "/a/b.ts" }));
    assert_client_roundtrip(json!({
        "type": "unsubscribe:file",
        "path": "/a/b.ts",
        "projectId": "proj_1",
        "chatId": "chat_1"
    }));
}
