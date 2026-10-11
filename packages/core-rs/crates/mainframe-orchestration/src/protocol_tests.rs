use super::*;

#[test]
fn version_negotiation_echoes_supported_and_falls_back_to_newest() {
    assert_eq!(negotiate_version(Some("2025-11-25")), "2025-11-25");
    assert_eq!(negotiate_version(Some("2025-06-18")), "2025-06-18");
    assert_eq!(negotiate_version(Some("2024-11-05")), "2025-11-25");
    assert_eq!(negotiate_version(None), "2025-11-25");
}

#[test]
fn initialize_reports_tools_capability_and_short_instructions() {
    let result = initialize_result(&json!({ "protocolVersion": "2025-03-26" }), "1.2.3");
    assert_eq!(result["protocolVersion"], "2025-03-26");
    assert_eq!(result["capabilities"]["tools"]["listChanged"], false);
    assert_eq!(result["serverInfo"]["name"], "mainframe");
    assert_eq!(result["serverInfo"]["version"], "1.2.3");
    assert!(INSTRUCTIONS.chars().count() <= 800);
}

#[test]
fn instructions_are_standalone_and_cover_ids_delegation_async_waits_and_permissions() {
    for needle in [
        "Mainframe chat ids",
        "delegate_task",
        "chat_launch",
        "capabilities",
        "async",
        "45 s",
        "remainingMs",
        "data from another agent",
        "Only the user answers permission prompts",
    ] {
        assert!(INSTRUCTIONS.contains(needle), "missing {needle:?}");
    }
}

#[test]
fn classify_sorts_requests_notifications_and_responses() {
    let req = classify(br#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#);
    assert!(matches!(req, Ok(Incoming::Request { .. })));
    let note = classify(br#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#);
    assert!(matches!(note, Ok(Incoming::Notification { .. })));
    let resp = classify(br#"{"jsonrpc":"2.0","id":"a","result":{}}"#);
    assert_eq!(resp, Ok(Incoming::Response));
}

#[test]
fn classify_rejects_parse_errors_batches_and_bad_envelopes() {
    let code = |r: Result<Incoming, RpcReply>| match r {
        Err(RpcReply::BadRequest(v)) => v["error"]["code"].as_i64(),
        _ => None,
    };
    assert_eq!(code(classify(b"{not json")), Some(-32700));
    assert_eq!(code(classify(b"[]")), Some(-32600));
    assert_eq!(code(classify(br#"{"id":1,"method":"ping"}"#)), Some(-32600));
    assert_eq!(
        code(classify(br#"{"jsonrpc":"2.0","id":{},"method":"ping"}"#)),
        Some(-32600)
    );
}
