use super::*;

#[test]
fn execution_mode_serializes_camelcase() {
    assert_eq!(
        serde_json::to_string(&ExecutionMode::AcceptEdits).unwrap(),
        "\"acceptEdits\""
    );
    assert_eq!(
        serde_json::to_string(&ExecutionMode::Yolo).unwrap(),
        "\"yolo\""
    );
    assert_eq!(
        serde_json::to_string(&ExecutionMode::Auto).unwrap(),
        "\"auto\""
    );
}

#[test]
fn execution_mode_strings_match_persisted_names() {
    for (mode, expected) in [
        (ExecutionMode::Default, "default"),
        (ExecutionMode::AcceptEdits, "acceptEdits"),
        (ExecutionMode::Auto, "auto"),
        (ExecutionMode::Yolo, "yolo"),
    ] {
        assert_eq!(mode.as_str(), expected);
        assert_eq!(serde_json::to_value(mode).unwrap(), expected);
    }
}

#[test]
fn permission_mode_auto_serializes_as_auto() {
    assert_eq!(
        serde_json::to_string(&PermissionMode::Auto).unwrap(),
        "\"auto\""
    );
}

#[test]
fn execution_mode_auto_round_trips() {
    assert_eq!(
        serde_json::from_str::<ExecutionMode>("\"auto\"").unwrap(),
        ExecutionMode::Auto
    );
}

#[test]
fn execution_modes_constant_lists_four_modes_in_permissiveness_order() {
    assert_eq!(
        EXECUTION_MODES,
        [
            ExecutionMode::Default,
            ExecutionMode::AcceptEdits,
            ExecutionMode::Auto,
            ExecutionMode::Yolo,
        ]
    );
}

#[test]
fn bool_string_serializes_lowercase() {
    assert_eq!(
        serde_json::to_string(&BoolString::True).unwrap(),
        "\"true\""
    );
}

#[test]
fn provider_config_omits_all_absent_fields() {
    let cfg = ProviderConfig::default();
    assert_eq!(serde_json::to_string(&cfg).unwrap(), "{}");
}

#[test]
fn provider_config_round_trips_populated() {
    let json = r#"{"defaultModel":"opus","defaultMode":"acceptEdits","defaultPlanMode":"false","personality":"friendly","reasoningSummary":"auto"}"#;
    let cfg: ProviderConfig = serde_json::from_str(json).unwrap();
    assert_eq!(cfg.default_mode, Some(ExecutionMode::AcceptEdits));
    assert_eq!(cfg.personality, Some(Personality::Friendly));
    assert_eq!(serde_json::to_string(&cfg).unwrap(), json);
}

#[test]
fn provider_config_default_effort_is_effort_level() {
    let json = r#"{"defaultEffort":"high"}"#;
    let cfg: ProviderConfig = serde_json::from_str(json).unwrap();
    assert_eq!(cfg.default_effort, Some(crate::adapter::EffortLevel::High));
    assert_eq!(serde_json::to_string(&cfg).unwrap(), json);
}

#[test]
fn notification_defaults_match_ts_constant() {
    let json = serde_json::to_string(&NotificationConfig::default()).unwrap();
    assert_eq!(
        json,
        r#"{"chat":{"taskComplete":true,"sessionError":true,"attentionRequest":true},"permission":{"toolRequest":true,"userQuestion":true,"planApproval":true},"other":{"plugin":true}}"#
    );
}

#[test]
fn general_defaults_match_ts_constant() {
    assert_eq!(GeneralConfig::default().worktree_dir, ".worktrees");
    assert_eq!(
        GeneralConfig::default().update_channel,
        UpdateChannel::Stable
    );
    assert_eq!(GeneralConfig::default().default_adapter_id, None);
}

/// `defaultAdapterId` always serializes (as `null` when absent) — no
/// `skip_serializing_if`, so the general settings payload always carries the
/// key rather than omitting it.
#[test]
fn general_config_default_adapter_id_serializes_as_explicit_null() {
    let value = serde_json::to_value(GeneralConfig::default()).unwrap();
    assert_eq!(value["defaultAdapterId"], serde_json::Value::Null);
}

#[test]
fn update_channel_serializes_lowercase() {
    assert_eq!(
        serde_json::to_string(&UpdateChannel::Prerelease).unwrap(),
        "\"prerelease\""
    );
}
