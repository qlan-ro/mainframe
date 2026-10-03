use super::*;
#[tokio::test]
async fn set_permission_mode_maps_yolo_to_bypass_permissions() {
    let s = session();
    let mut rx = spawned_with_stdin(&s);
    s.set_permission_mode(ExecutionMode::Yolo).await.unwrap();
    assert_eq!(read_json(&mut rx)["request"]["mode"], "bypassPermissions");
}

#[tokio::test]
async fn set_permission_mode_sends_auto_verbatim() {
    let s = session();
    let mut rx = spawned_with_stdin(&s);
    s.set_permission_mode(ExecutionMode::Auto).await.unwrap();
    let payload = read_json(&mut rx);
    assert_eq!(payload["request"]["subtype"], "set_permission_mode");
    assert_eq!(payload["request"]["mode"], "auto");
}

#[tokio::test]
async fn set_permission_mode_throws_when_not_spawned() {
    let s = session();
    let err = s
        .set_permission_mode(ExecutionMode::Default)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("not spawned"));
}

#[tokio::test]
async fn each_control_request_has_a_unique_request_id() {
    let s = session();
    let mut rx = spawned_with_stdin(&s);
    s.set_permission_mode(ExecutionMode::Default).await.unwrap();
    let id1 = read_json(&mut rx)["request_id"]
        .as_str()
        .unwrap()
        .to_string();
    let s2 = s.clone();
    let pending = tokio::spawn(async move { s2.set_model("claude-opus-4-6".to_string()).await });
    let payload = loop {
        tokio::task::yield_now().await;
        if let Ok(bytes) = rx.try_recv() {
            break serde_json::from_slice::<Value>(&bytes).unwrap();
        }
    };
    let id2 = payload["request_id"].as_str().unwrap().to_string();
    assert!(s.control.resolve(
        &id2,
        Some(json!({ "request_id": id2, "subtype": "success" }))
    ));
    pending.await.unwrap().unwrap();
    assert_ne!(id1, id2);
}

#[tokio::test]
async fn set_permission_mode_sends_control_request_payload() {
    let s = session();
    let mut rx = spawned_with_stdin(&s);
    s.set_permission_mode(ExecutionMode::Default).await.unwrap();
    let payload = read_json(&mut rx);
    assert_eq!(payload["type"], "control_request");
    assert!(payload["request_id"].as_str().is_some());
    assert_eq!(payload["request"]["subtype"], "set_permission_mode");
    assert_eq!(payload["request"]["mode"], "default");
}

#[tokio::test]
async fn leaving_plan_mode_restores_auto() {
    let s = session();
    let mut rx = spawned_with_stdin(&s);
    s.set_permission_mode(ExecutionMode::Auto).await.unwrap();
    assert_eq!(read_json(&mut rx)["request"]["mode"], "auto");

    s.set_plan_mode(true).await.unwrap();
    assert_eq!(read_json(&mut rx)["request"]["mode"], "plan");

    s.set_plan_mode(false).await.unwrap();
    assert_eq!(read_json(&mut rx)["request"]["mode"], "auto");
}

#[tokio::test]
async fn set_model_throws_when_not_spawned() {
    let s = session();
    let err = s
        .set_model("claude-opus-4-6".to_string())
        .await
        .unwrap_err();
    assert!(err.to_string().contains("not spawned"));
}

#[tokio::test]
async fn set_plan_mode_true_sends_plan() {
    let s = session();
    let mut rx = spawned_with_stdin(&s);
    s.set_plan_mode(true).await.unwrap();
    assert_eq!(read_json(&mut rx)["request"]["mode"], "plan");
}

#[tokio::test]
async fn set_model_sends_control_request_and_awaits_success() {
    let s = session();
    let mut rx = spawned_with_stdin(&s);
    let s2 = s.clone();
    let pending =
        tokio::spawn(async move { s2.set_model("claude-sonnet-4-5-20250929".to_string()).await });
    let payload = loop {
        tokio::task::yield_now().await;
        if let Ok(bytes) = rx.try_recv() {
            break serde_json::from_slice::<Value>(&bytes).unwrap();
        }
    };
    let request_id = payload["request_id"].as_str().unwrap();
    assert_eq!(payload["request"]["subtype"], "set_model");
    assert_eq!(payload["request"]["model"], "claude-sonnet-4-5-20250929");
    assert!(s.control.resolve(
        request_id,
        Some(json!({ "request_id": request_id, "subtype": "success" }))
    ));
    pending.await.unwrap().unwrap();
}
