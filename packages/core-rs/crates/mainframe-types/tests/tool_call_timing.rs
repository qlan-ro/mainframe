#![allow(clippy::unwrap_used)]

use mainframe_types::chat::MessageContentNode;
use serde_json::json;

#[test]
fn tool_call_timing_normalized_history_round_trips() {
    let call = json!({"type":"tool_use", "id":"a", "name":"Bash", "input":{},
        "timing":{"startedAt":1000,"completedAt":1200}});
    let parsed: MessageContentNode = serde_json::from_value(call.clone()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), call);
}

#[test]
fn tool_call_timing_invalid_history_is_ignored_without_losing_call() {
    for timing in [
        json!({"startedAt":-1}),
        json!({"startedAt":1.5}),
        json!({"completedAt":1000}),
        json!({"startedAt":9007199254740992_u64}),
        json!({"startedAt":1000,"completedAt":999}),
        json!({"startedAt":1000,"completedAt":null}),
    ] {
        let call = json!({"type":"tool_use", "id":"a", "name":"Bash", "input":{}, "timing":timing});
        let parsed: MessageContentNode = serde_json::from_value(call).unwrap();
        let output = serde_json::to_value(parsed).unwrap();
        assert_eq!(output["id"], "a");
        assert!(output.get("timing").is_none());
    }
}
