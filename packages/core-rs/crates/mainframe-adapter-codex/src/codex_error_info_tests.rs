use super::*;
use serde_json::json;

const STREAM_TEXT: &str =
    "stream disconnected before completion: stream closed before response.completed";

#[test]
fn classifies_every_shape_the_schema_allows() {
    let cases = [
        (
            json!("serverOverloaded"),
            Some(CodexErrorKind::ServerOverloaded),
        ),
        (json!("other"), Some(CodexErrorKind::Other)),
        (
            json!({"responseStreamDisconnected": {"httpStatusCode": null}}),
            Some(CodexErrorKind::StreamDropped),
        ),
        (
            json!({"responseTooManyFailedAttempts": {"httpStatusCode": 503}}),
            Some(CodexErrorKind::StreamDropped),
        ),
        (
            json!({"responseTooManyFailedAttempts": {}}),
            Some(CodexErrorKind::StreamDropped),
        ),
        (
            json!({"responseTooManyFailedAttempts": 7}),
            Some(CodexErrorKind::StreamDropped),
        ),
        (json!("contextWindowExceeded"), None),
        (json!("brandNewVariant"), None),
        (json!({"brandNewVariant": {"x": 1}}), None),
        (json!({"a": 1, "b": 2}), None),
        (json!(42), None),
        (json!([]), None),
        (Value::Null, None),
    ];
    for (value, expected) in cases {
        assert_eq!(classify(Some(&value)), expected, "{value}");
    }
    assert_eq!(classify(None), None);
}

#[test]
fn stream_text_gets_the_stream_headline_with_or_without_metadata() {
    let expected = format!("{STREAM_HEADLINE}\n\n{STREAM_TEXT}");
    for kind in [
        None,
        Some(CodexErrorKind::Other),
        Some(CodexErrorKind::ServerOverloaded),
    ] {
        assert_eq!(describe(STREAM_TEXT.into(), kind), expected, "{kind:?}");
    }
    let short = "stream closed before response.completed";
    assert_eq!(
        describe(short.into(), None),
        format!("{STREAM_HEADLINE}\n\n{short}")
    );
}

#[test]
fn a_stream_kind_gets_the_stream_headline_even_with_other_text() {
    assert_eq!(
        describe(
            "websocket went away".into(),
            Some(CodexErrorKind::StreamDropped)
        ),
        format!("{STREAM_HEADLINE}\n\nwebsocket went away")
    );
}

#[test]
fn the_capacity_sentence_passes_through_and_other_text_gets_it_as_headline() {
    assert_eq!(
        describe(CAPACITY.into(), Some(CodexErrorKind::ServerOverloaded)),
        CAPACITY
    );
    assert_eq!(
        describe(
            "busy right now".into(),
            Some(CodexErrorKind::ServerOverloaded)
        ),
        format!("{CAPACITY}\n\nbusy right now")
    );
}

#[test]
fn other_gets_the_generic_headline() {
    assert_eq!(
        describe("hook failed: exit 1".into(), Some(CodexErrorKind::Other)),
        format!("{GENERIC_HEADLINE}\n\nhook failed: exit 1")
    );
}

#[test]
fn no_metadata_and_no_stream_text_stays_raw() {
    assert_eq!(describe("something odd".into(), None), "something odd");
}

#[test]
fn an_empty_message_yields_just_the_headline() {
    assert_eq!(
        describe("  ".into(), Some(CodexErrorKind::Other)),
        GENERIC_HEADLINE
    );
}
