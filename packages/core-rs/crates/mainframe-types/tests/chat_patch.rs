#![allow(clippy::unwrap_used, clippy::expect_used)]
use mainframe_types::{
    chat::{Chat, NewChat},
    chat_patch::ChatPatch,
};
use serde_json::json;

#[test]
fn tuning_patch_preserves_absent_null_and_value_on_the_flat_wire() {
    for payload in [
        json!({}),
        json!({"effort":null,"fast":true}),
        json!({"effort":"high","ultracode":false,"adaptiveThinking":null}),
    ] {
        let patch: ChatPatch = serde_json::from_value(payload.clone()).unwrap();
        assert_eq!(serde_json::to_value(&patch).unwrap(), payload);
    }
    let patch: ChatPatch = serde_json::from_value(json!({"fast":null})).unwrap();
    assert_eq!(patch.fast, Some(None));
    assert_eq!(patch.effort, None);
}

#[test]
fn unpersisted_chat_has_unique_ids_shared_timestamps_and_no_internal_wire_fields() {
    let input = NewChat {
        project_id: "project".into(),
        adapter_id: "claude".into(),
        permission_mode: Some("yolo".into()),
        temporary: true,
        ..Default::default()
    };
    let first = Chat::unpersisted(&input);
    let second = Chat::unpersisted(&input);
    assert_ne!(first.id, second.id);
    assert_eq!(first.created_at, first.updated_at);
    assert_eq!(first.project_id, "project");
    let value = serde_json::to_value(first).unwrap();
    assert_eq!(value["temporary"], true);
    assert_eq!(value["planMode"], false);
    assert_eq!(value["permissionMode"], "yolo");
    for field in [
        "vendorSessionEphemeral",
        "scratchPath",
        "tuning",
        "effort",
        "fast",
    ] {
        assert!(value.get(field).is_none(), "{field}");
    }
}
