use serde_json::json;

use super::*;
use crate::input::golden::{fixture_keys, schema_properties};
use crate::test_support::{FakePort, service_with};

#[test]
fn schema_matches_the_input_struct() {
    let accept = json!({
        "projectId": "p", "status": "all", "titleContains": "x",
        "includeDelegated": false, "limit": 5, "offset": 0
    });
    assert_eq!(
        schema_properties(&definition().input_schema),
        fixture_keys(&accept)
    );
    assert!(parse_args::<Input>(accept).is_ok());
    assert!(parse_args::<Input>(json!({ "status": "gone" })).is_err());
    assert!(parse_args::<Input>(json!({ "limit": 0 })).is_err());
    assert!(parse_args::<Input>(json!({ "projectId": "../x" })).is_err());
    assert!(parse_args::<Input>(json!({ "nope": 1 })).is_err());
}

#[tokio::test]
async fn lists_newest_first_and_hides_side_temporary_and_automation_chats() {
    let port = FakePort::new();
    let mut caller = port.add_chat("caller");
    caller.updated_at = "0".into();
    port.put(caller);
    for (id, updated) in [("a", "1"), ("b", "3"), ("c", "2")] {
        let mut chat = port.add_chat(id);
        chat.updated_at = updated.into();
        port.put(chat);
    }
    port.update("c", |c| c.temporary = true);
    let mut auto = port.add_chat("auto");
    auto.automation = true;
    port.put(auto);
    let (svc, ctx) = service_with(port, "caller");
    let out = run(&svc, &ctx, json!({ "limit": 2 })).await.unwrap();
    let ids: Vec<_> = out["chats"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["chatId"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(ids, vec!["b", "a"]);
    assert_eq!(out["total"], 3, "b, a, and the caller itself");
    assert_eq!(out["nextOffset"], 2);
}

#[tokio::test]
async fn unknown_project_is_reported() {
    let port = FakePort::new();
    port.add_chat("caller");
    let (svc, ctx) = service_with(port, "caller");
    let err = run(&svc, &ctx, json!({ "projectId": "zzz" }))
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::ProjectNotFound);
}
