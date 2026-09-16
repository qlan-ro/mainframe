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
