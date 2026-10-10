//! Checkpoint step kinds keep their stored wire strings.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use mainframe_types::automation::AutomationStepKind;

#[test]
fn checkpoint_kinds_keep_existing_wire_strings() {
    for (wire, expected) in [
        ("ask_agent", AutomationStepKind::AskAgent),
        ("ask_me", AutomationStepKind::AskMe),
        ("run_action", AutomationStepKind::RunAction),
        ("notify", AutomationStepKind::Notify),
        ("set_variable", AutomationStepKind::SetVariable),
        ("wait", AutomationStepKind::Wait),
        ("break", AutomationStepKind::Break),
        ("if", AutomationStepKind::If),
        ("repeat", AutomationStepKind::Repeat),
        ("loop", AutomationStepKind::Loop),
        ("retry", AutomationStepKind::Retry),
        ("parallel", AutomationStepKind::Parallel),
        ("retry_attempt", AutomationStepKind::RetryAttempt),
        ("branch_outcome", AutomationStepKind::BranchOutcome),
        ("repeat_watermark", AutomationStepKind::RepeatWatermark),
    ] {
        let parsed: AutomationStepKind =
            serde_json::from_str(&format!("\"{wire}\"")).expect("checkpoint kind must deserialize");
        assert_eq!(parsed, expected);
        assert_eq!(
            serde_json::to_string(&parsed).unwrap(),
            format!("\"{wire}\"")
        );
    }
}

#[test]
fn unknown_legacy_kind_round_trips_without_data_loss() {
    let kind: AutomationStepKind = serde_json::from_str("\"custom_legacy_kind\"").unwrap();
    assert_eq!(kind, AutomationStepKind::from("custom_legacy_kind"));
    assert!(
        matches!(&kind, AutomationStepKind::Other(unknown) if unknown.as_str() == "custom_legacy_kind")
    );
    assert_eq!(
        serde_json::to_string(&kind).unwrap(),
        "\"custom_legacy_kind\""
    );
}

#[test]
fn only_engine_bookkeeping_kinds_are_markers() {
    assert!(AutomationStepKind::RetryAttempt.is_engine_marker());
    assert!(AutomationStepKind::BranchOutcome.is_engine_marker());
    assert!(AutomationStepKind::RepeatWatermark.is_engine_marker());
    assert!(!AutomationStepKind::AskAgent.is_engine_marker());
    assert!(!AutomationStepKind::Retry.is_engine_marker());
    assert!(!AutomationStepKind::from("branch").is_engine_marker());
}

/// `From<&str>` is the only constructor for a wire string, so a known string
/// always lands on its named variant, never on `Other`.
#[test]
fn known_wire_strings_never_become_other() {
    assert_eq!(
        AutomationStepKind::from("ask_agent"),
        AutomationStepKind::AskAgent
    );
    assert_eq!(
        AutomationStepKind::from("ask_agent".to_string()),
        AutomationStepKind::AskAgent
    );
    assert_eq!(
        AutomationStepKind::from("repeat_watermark"),
        AutomationStepKind::RepeatWatermark
    );
}
