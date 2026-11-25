use super::*;
#[test]
fn control_cancel_request_forwards_the_request_id_to_the_sink() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "control_cancel_request", "request_id": "req_7" }),
    );
    assert_eq!(sink.r().cancelled, vec!["req_7".to_string()]);
    assert!(sink.r().permissions.is_empty());
}

#[test]
fn control_response_unknown_request_id_does_not_panic() {
    let s = session();
    let sink = RecordingSink::default();
    handle_control_response_event(
        &s,
        &serde_json::json!({ "type": "control_response", "response": { "request_id": "unknown", "subtype": "success" } }),
        &sink,
    );
}

#[tokio::test]
async fn control_response_resolves_a_real_pending_stop_task_awaiter() {
    let s = session();
    let sink = RecordingSink::default();
    let (tx, mut rx) = crate::session_control::StdinTx::channel(8);
    let control = s.control.clone();
    let pending = tokio::spawn(async move {
        control
            .send_awaiting(
                Some(&tx),
                &serde_json::json!({ "subtype": "stop_task", "task_id": "t1" }),
                crate::session_control::SendAwaitingOpts {
                    label: "stop_task".to_string(),
                    timeout_ms: Some(1000),
                    is_terminal: Some(Box::new(|r: &Option<Value>| {
                        r.as_ref()
                            .and_then(|v| v.get("subtype"))
                            .and_then(Value::as_str)
                            == Some("error")
                            || r.as_ref()
                                .and_then(|v| v.get("subtype"))
                                .and_then(Value::as_str)
                                == Some("success")
                    })),
                },
            )
            .await
    });
    let request_id = loop {
        tokio::task::yield_now().await;
        if let Ok(bytes) = rx.try_recv() {
            break serde_json::from_slice::<Value>(&bytes).unwrap()["request_id"]
                .as_str()
                .unwrap()
                .to_string();
        }
    };
    handle_control_response_event(
        &s,
        &serde_json::json!({ "type": "control_response", "response": { "request_id": request_id, "subtype": "error", "error": "no such task" } }),
        &sink,
    );
    let raw = pending.await.unwrap().unwrap();
    assert_eq!(raw["subtype"], "error");
    assert_eq!(raw["error"], "no such task");
}

#[test]
fn a_cancel_frame_without_a_usable_request_id_forwards_nothing() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "control_cancel_request" }),
    );
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "control_cancel_request", "request_id": "" }),
    );
    assert!(sink.r().cancelled.is_empty());
}

fn suggestions_of(suggestions: Value) -> Vec<mainframe_types::adapter::ControlUpdate> {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({
            "type": "control_request",
            "request_id": "req_8",
            "request": {
                "subtype": "can_use_tool",
                "tool_name": "Bash",
                "tool_use_id": "tu_8",
                "input": {},
                "permission_suggestions": suggestions
            }
        }),
    );
    sink.r().permissions[0].suggestions.clone()
}

#[test]
fn one_suggestion_it_cannot_read_does_not_drop_the_others() {
    let rule = serde_json::json!({
        "type": "addRules",
        "rules": [{ "toolName": "Bash", "ruleContent": "ls *" }],
        "behavior": "allow",
        "destination": "localSettings"
    });
    let bypass = serde_json::json!({ "type": "setMode", "mode": "bypassPermissions", "destination": "session" });

    let read = suggestions_of(serde_json::json!([bypass, rule]));

    assert_eq!(
        read[0],
        mainframe_types::adapter::ControlUpdate::Unknown(bypass)
    );
    assert!(read[1].grantable());
    assert_eq!(serde_json::to_value(&read[1]).unwrap(), rule);
}

#[test]
fn suggestions_that_are_not_a_list_grant_nothing() {
    assert!(suggestions_of(Value::Null).is_empty());
    let read = suggestions_of(serde_json::json!({ "type": "addRules" }));
    assert_eq!(read.len(), 1);
    assert!(!read[0].grantable());
}
