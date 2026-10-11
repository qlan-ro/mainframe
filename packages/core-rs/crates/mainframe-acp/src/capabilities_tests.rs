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
