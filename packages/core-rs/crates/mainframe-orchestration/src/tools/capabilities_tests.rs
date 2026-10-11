use serde_json::json;

use super::*;
use crate::input::golden::{fixture_keys, schema_properties};
use crate::test_support::{FakePort, service_with};

#[test]
fn schema_matches_the_input_struct() {
    let def = definition();
    let accept = json!({});
    assert_eq!(schema_properties(&def.input_schema), fixture_keys(&accept));
    assert!(parse_args::<Input>(accept).is_ok());
    assert!(parse_args::<Input>(Value::Null).is_ok());
    assert!(parse_args::<Input>(json!({ "extra": 1 })).is_err());
}

#[tokio::test]
async fn reports_caller_depth_modes_and_adapters() {
    let port = FakePort::new();
    let mut root = port.add_chat("root");
    root.permission_mode = ExecutionMode::AcceptEdits;
    port.put(root);
    let mut child = port.add_chat("child");
    child.created_by_chat_id = Some("root".into());
    child.permission_mode = ExecutionMode::AcceptEdits;
    port.put(child);
    let (svc, ctx) = service_with(port, "child");
    let out = run(&svc, &ctx, json!({})).await.unwrap();
    assert_eq!(out["caller"]["depth"], 1);
    assert_eq!(
        out["allowedPermissionModes"]["claude"],
        json!(["default", "acceptEdits"])
    );
    assert_eq!(out["adapters"][0]["id"], "claude");
    assert_eq!(out["limits"]["launchesRemaining"], 20);
    assert_eq!(out["limits"]["maxSingleWaitMs"], MAX_SINGLE_WAIT_MS);
    // One meaning per allowed mode, keyed the same way as
    // `allowedPermissionModes`, and non-empty.
    assert_eq!(
        out["permissionModeMeanings"]["claude"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<std::collections::HashSet<_>>(),
        ["default", "acceptEdits"]
            .into_iter()
            .map(String::from)
            .collect::<std::collections::HashSet<_>>()
    );
    assert!(
        !out["permissionModeMeanings"]["claude"]["default"]
            .as_str()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn allowed_permission_modes_are_per_adapter_not_one_flat_list() {
    // A Codex caller in `acceptEdits` (effective rank 1, same as
    // `default` on Codex) must see `default` and `acceptEdits` allowed
    // on Codex, but never `auto` — Codex has no distinct auto mode
    // (`auto_mode: false`) even though its effective rank for `auto`
    // happens to match — and only up through Claude's own rank-1 mode
    // on Claude.
    let port = FakePort::new();
    port.lock().adapters.push(crate::ports::AdapterView {
        id: "codex".into(),
        name: "Codex".into(),
        installed: true,
        available: true,
        unavailable_reason: None,
        models: vec![],
        steer: false,
        auto_mode: false,
    });
    let mut caller = port.add_chat("caller");
    caller.adapter_id = "codex".into();
    caller.permission_mode = ExecutionMode::AcceptEdits;
    port.put(caller);
    let (svc, ctx) = service_with(port, "caller");
    let out = run(&svc, &ctx, json!({})).await.unwrap();
    assert_eq!(
        out["allowedPermissionModes"]["codex"],
        json!(["default", "acceptEdits"])
    );
    assert_eq!(
        out["allowedPermissionModes"]["claude"],
        json!(["default", "acceptEdits"])
    );
}
