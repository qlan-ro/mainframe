use super::*;
use serde_json::json;

// Pure framing tests. A full stdin queue is covered in `write_tests.rs`;
// the process-backed close/dispatch cases need a mock child process and
// are a known test gap.

#[test]
fn parses_a_single_json_object_line() {
    let msgs = parse_jsonrpc_messages(r#"{"method":"turn/started","params":{}}"#).expect("parse");
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].get("method"), Some(&json!("turn/started")));
}

#[test]
fn dispatches_a_valid_object_before_trailing_stdout_noise_on_the_same_line() {
    let notification = r#"{"method":"thread/tokenUsage/updated","params":{"tokenUsage":{"total":{"totalTokens":20805}}}}"#;
    let line = format!("{notification}progress: still running");
    let msgs = parse_jsonrpc_messages(&line).expect("parse");
    assert_eq!(msgs.len(), 1);
    assert_eq!(
        msgs[0].get("method"),
        Some(&json!("thread/tokenUsage/updated"))
    );
}

#[test]
fn skips_malformed_json_lines() {
    assert!(parse_jsonrpc_messages("not valid json").is_err());
}

#[test]
fn find_json_object_end_returns_index_past_first_object() {
    assert_eq!(find_json_object_end(r#"{"a":1}{"b":2}"#), Some(7));
    // A `}` inside a string must NOT close the object (depth tracking + string skip).
    assert_eq!(find_json_object_end(r#"{"a":"}"}"#), Some(9));
    assert_eq!(find_json_object_end(r#"{"a":1"#), None);
}
