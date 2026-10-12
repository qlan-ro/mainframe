//! Resolving a command/file-change approval, whose answer is a decision
//! string rather than an answer map.

use super::*;

#[test]
fn accept_for_session_reaches_codex() {
    let rec = Recorder::new();
    let handler = ApprovalHandler::new(rec.sink());
    let (respond, calls) = recording_respond();
    handler.handle_request(
        "item/commandExecution/requestApproval",
        &json!({ "itemId": "tc9", "command": "cargo test" }),
        RequestId::Number(22),
        respond,
    );
    let request = rec.permissions()[0].clone();

    resolve(
        &handler,
        json!({
            "requestId": request.request_id,
            "toolUseId": request.tool_use_id,
            "behavior": "allow",
            "scope": "session",
        }),
    );

    assert_eq!(
        calls.lock().unwrap()[0].1,
        json!({ "decision": "acceptForSession" })
    );
}

/// A reply the app-server's stdin cannot take (its queue is full).
fn failing_respond() -> RespondFn {
    Box::new(|_, _| {
        Err(JsonRpcError(
            "Response to request 22 not written: child stdin queue full".to_string(),
        ))
    })
}

#[test]
fn an_unwritten_approval_reply_is_an_error_for_the_caller() {
    let rec = Recorder::new();
    let handler = ApprovalHandler::new(rec.sink());
    handler.handle_request(
        "item/commandExecution/requestApproval",
        &json!({ "itemId": "tc9", "command": "cargo test" }),
        RequestId::Number(22),
        failing_respond(),
    );
    let request = rec.permissions()[0].clone();
    let response: ControlResponse =
        serde_json::from_value(decision_for(&request, json!({ "behavior": "allow" }))).unwrap();

    let error = handler.resolve(&response).unwrap_err();

    assert_eq!(
        error.0,
        "Response to request 22 not written: child stdin queue full"
    );
}

#[test]
fn an_unwritten_automatic_reply_is_reported_on_the_session() {
    let rec = Recorder::new();
    let handler = ApprovalHandler::new(rec.sink());

    handler.handle_request(
        "item/unknown/request",
        &json!({}),
        RequestId::Number(22),
        failing_respond(),
    );

    assert_eq!(
        rec.errors(),
        vec!["Response to request 22 not written: child stdin queue full".to_string()]
    );
}
