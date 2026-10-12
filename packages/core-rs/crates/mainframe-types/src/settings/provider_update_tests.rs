use super::*;
use crate::settings::{ProviderConfig, ResolvedExecutable, ResolvedExecutableSource};

/// Every `ProviderConfig` field populated. A struct literal, so adding a
/// field to `ProviderConfig` fails to compile here until this test (and the
/// field table) learn about it.
fn full_provider_config() -> ProviderConfig {
    ProviderConfig {
        default_model: Some("m".into()),
        default_mode: Some(ExecutionMode::Auto),
        default_plan_mode: Some(BoolString::True),
        executable_path: Some("/p".into()),
        system_prompt: Some("s".into()),
        resolved_executable: Some(ResolvedExecutable {
            path: "/p".into(),
            source: ResolvedExecutableSource::Config,
            valid: true,
            version: None,
        }),
        default_effort: Some(EffortLevel::High),
        default_fast: Some(BoolString::False),
        default_ultracode: Some(BoolString::False),
        default_adaptive_thinking: Some(BoolString::False),
        personality: Some(Personality::None),
        reasoning_summary: Some(ReasoningSummary::Auto),
        cliproxy_small_fast_model: Some("f".into()),
    }
}

#[test]
fn field_list_names_every_stored_provider_config_field() {
    let value = serde_json::to_value(full_provider_config()).unwrap();
    let mut wire: Vec<&str> = value
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .filter(|k| *k != "resolvedExecutable")
        .collect();
    wire.sort_unstable();
    let mut fields = PROVIDER_CONFIG_FIELDS.to_vec();
    fields.sort_unstable();
    assert_eq!(fields, wire);
}

#[test]
fn deserializes_wire_names_and_lists_only_present_fields() {
    let update: ProviderConfigUpdate = serde_json::from_str(
        r#"{"defaultModel":"opus","personality":"","reasoningSummary":"auto","unknown":"x"}"#,
    )
    .unwrap();
    assert_eq!(
        update.into_present_fields(),
        vec![
            ("defaultModel", "opus".to_string()),
            ("personality", String::new()),
            ("reasoningSummary", "auto".to_string()),
        ]
    );
}

#[test]
fn validity_follows_each_fields_enum_and_clear_rule() {
    let valid = |json: &str| {
        serde_json::from_str::<ProviderConfigUpdate>(json)
            .unwrap()
            .is_valid()
    };
    assert!(valid(
        r#"{"defaultMode":"acceptEdits","defaultPlanMode":"false"}"#
    ));
    assert!(valid(
        r#"{"defaultEffort":"","defaultFast":"","personality":"friendly"}"#
    ));
    assert!(valid(
        r#"{"defaultModel":"","executablePath":"anything at all"}"#
    ));
    assert!(!valid(r#"{"defaultMode":""}"#));
    assert!(!valid(r#"{"defaultMode":"plan"}"#));
    assert!(!valid(r#"{"defaultPlanMode":""}"#));
    assert!(!valid(r#"{"defaultEffort":"extreme"}"#));
    assert!(!valid(r#"{"defaultUltracode":"TRUE"}"#));
    assert!(!valid(r#"{"reasoningSummary":"verbose"}"#));
}
