use super::*;
use serde_json::json;

#[test]
fn reads_the_fraction_from_codex_reconnect_text() {
    assert_eq!(attempt_fraction("Reconnecting... 2/5"), Some((2, 5)));
    assert_eq!(
        attempt_fraction("Reconnecting... 10/12 (x)"),
        Some((10, 12))
    );
}

#[test]
fn takes_the_first_fraction() {
    assert_eq!(attempt_fraction("retry 1/5 then 3/9"), Some((1, 5)));
}

#[test]
fn skips_slashes_that_are_not_fractions() {
    assert_eq!(
        attempt_fraction("see https://x.test/a then 4/6"),
        Some((4, 6))
    );
    assert_eq!(attempt_fraction("a/b 7/ 8"), None);
}

#[test]
fn no_fraction_yields_none() {
    assert_eq!(
        attempt_fraction("Reconnecting... waiting for network"),
        None
    );
    assert_eq!(attempt_fraction(""), None);
    assert_eq!(attempt_fraction("99999999999999999999/5"), None);
}

#[test]
fn absent_optionals_are_skipped_on_the_wire() {
    let params = RetryStatusParams {
        session_id: "s".into(),
        attempt: 2,
        max_attempts: None,
        reason: None,
    };
    assert_eq!(
        serde_json::to_value(&params).unwrap(),
        json!({"sessionId": "s", "attempt": 2})
    );
}
