use super::super::*;
use super::*;
#[test]
fn parses_a_captured_api_error_line_into_on_api_retry() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({
            "type": "system",
            "subtype": "api_error",
            "level": "error",
            "error": "{status: 529, headers: {...}}",
            "retryInMs": 538.28,
            "retryAttempt": 1,
            "maxRetries": 10
        }),
    );
    assert_eq!(
        sink.r().api_retries,
        vec![(1, Some("{status: 529, headers: {...}}".to_string()))]
    );
}

#[test]
fn parses_complete_json_lines() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({ "type": "system", "subtype": "init", "session_id": "s1" }),
    );
    assert_eq!(sink.r().init, vec!["s1".to_string()]);
}

#[test]
fn skips_non_json_and_empty_lines() {
    let s = session();
    let sink = RecordingSink::default();
    handle_stdout(&s, b"not json at all\n", &sink);
    handle_stdout(&s, b"\n\n\n", &sink);
    assert!(sink.r().init.is_empty());
    assert_eq!(sink.r().messages, 0);
}

#[test]
fn handles_partial_chunks_by_buffering() {
    let s = session();
    let sink = RecordingSink::default();
    let event = serde_json::to_string(
        &serde_json::json!({ "type": "system", "subtype": "init", "session_id": "s1" }),
    )
    .unwrap();
    let (h1, h2) = event.split_at(20);
    handle_stdout(&s, h1.as_bytes(), &sink);
    assert!(sink.r().init.is_empty());
    handle_stdout(&s, format!("{h2}\n").as_bytes(), &sink);
    assert_eq!(sink.r().init, vec!["s1".to_string()]);
}

#[test]
fn an_unknown_event_type_touches_no_sink_callback() {
    let s = session();
    let sink = RecordingSink::default();
    feed(&s, &sink, serde_json::json!({ "type": "stream_event" }));
    let rec = sink.r();
    assert!(rec.init.is_empty());
    assert_eq!(rec.messages, 0);
    assert_eq!(rec.tool_results, 0);
    assert!(rec.permissions.is_empty());
    assert!(rec.cancelled.is_empty());
    assert_eq!(rec.results, 0);
    assert_eq!(rec.errors, 0);
}
