use super::*;
use serde_json::json;

/// Build the `serde_json::Map` the predicates operate on from a JSON object.
fn obj(v: Value) -> Map<String, Value> {
    match v {
        Value::Object(m) => m,
        _ => panic!("expected object"),
    }
}

// --- JSON-RPC message type guards (codex-types.test.ts) ---

#[test]
fn identifies_a_response_has_id_and_result() {
    assert!(is_json_rpc_response(&obj(
        json!({ "id": 1, "result": { "thread": { "id": "thr_1" } } })
    )));
}

#[test]
fn identifies_an_error_has_id_and_error() {
    assert!(is_json_rpc_error(&obj(
        json!({ "id": 1, "error": { "code": -32600, "message": "Invalid" } })
    )));
}

#[test]
fn identifies_a_notification_has_method_no_id() {
    assert!(is_json_rpc_notification(&obj(
        json!({ "method": "thread/started", "params": {} })
    )));
}

#[test]
fn identifies_a_server_request_has_method_and_id() {
    assert!(is_json_rpc_server_request(&obj(json!({
        "id": 5,
        "method": "item/commandExecution/requestApproval",
        "params": {}
    }))));
}

#[test]
fn does_not_confuse_response_with_server_request() {
    assert!(!is_json_rpc_server_request(&obj(
        json!({ "id": 1, "result": {} })
    )));
}

#[test]
fn does_not_confuse_notification_with_response() {
    assert!(!is_json_rpc_response(&obj(
        json!({ "method": "turn/started", "params": {} })
    )));
}

// --- resolved_usage (Codex 0.144.3 camelCase tokenUsage envelope) ---

#[test]
fn resolved_usage_prefers_the_captures_token_usage_last() {
    let params: TokenUsageUpdatedParams = serde_json::from_value(json!({
        "threadId": "thr_1",
        "tokenUsage": {
            "last": { "inputTokens": 10, "cachedInputTokens": 2, "outputTokens": 5 },
            "total": { "inputTokens": 100, "outputTokens": 50 }
        }
    }))
    .expect("parses");
    let usage = params.resolved_usage().expect("some usage");
    assert_eq!(usage.input_tokens, 10);
    assert_eq!(usage.cached_input_tokens, Some(2));
    assert_eq!(usage.output_tokens, 5);
}

#[test]
fn resolved_usage_falls_back_to_legacy_top_level_usage() {
    let params: TokenUsageUpdatedParams = serde_json::from_value(json!({
        "threadId": "thr_1",
        "usage": { "input_tokens": 7, "output_tokens": 3 }
    }))
    .expect("parses");
    let usage = params.resolved_usage().expect("some usage");
    assert_eq!(usage.input_tokens, 7);
    assert_eq!(usage.output_tokens, 3);
}

#[test]
fn resolved_usage_is_none_when_neither_shape_is_present() {
    let params: TokenUsageUpdatedParams = serde_json::from_value(json!({
        "threadId": "thr_1"
    }))
    .expect("parses");
    assert_eq!(params.resolved_usage(), None);
}
