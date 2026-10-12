use super::*;
use mainframe_types::adapter::EffortLevel;

fn tuning(effort: Option<EffortLevel>, fast: bool) -> ResolvedTuning {
    ResolvedTuning {
        effort,
        fast,
        ultracode: false,
        adaptive_thinking: false,
    }
}

// --- turn config ---

#[test]
fn puts_effort_in_settings_fast_as_service_tier_codex_extras_top_level() {
    let cfg = build_turn_config(
        &tuning(Some(EffortLevel::High), true),
        &CodexProviderTuning {
            personality: Some("pragmatic".to_string()),
            reasoning_summary: Some("concise".to_string()),
        },
        "gpt-5.5",
        "default",
    );
    assert_eq!(cfg.collaboration_mode.settings.model, "gpt-5.5");
    assert_eq!(
        cfg.collaboration_mode.settings.reasoning_effort,
        Some(EffortLevel::High)
    );
    assert_eq!(cfg.service_tier.as_deref(), Some("fast"));
    assert_eq!(cfg.personality.as_deref(), Some("pragmatic"));
    assert_eq!(cfg.summary.as_deref(), Some("concise"));
}

#[test]
fn service_tier_fast_when_tuning_fast_true_and_undefined_when_false() {
    assert_eq!(
        build_turn_config(
            &tuning(Some(EffortLevel::High), false),
            &CodexProviderTuning::default(),
            "m",
            "default"
        )
        .service_tier,
        None
    );
    assert_eq!(
        build_turn_config(
            &tuning(Some(EffortLevel::High), true),
            &CodexProviderTuning::default(),
            "m",
            "default"
        )
        .service_tier
        .as_deref(),
        Some("fast")
    );
}

#[test]
fn omits_personality_summary_when_not_provided() {
    let cfg = build_turn_config(
        &tuning(None, false),
        &CodexProviderTuning::default(),
        "m",
        "default",
    );
    assert_eq!(cfg.personality, None);
    assert_eq!(cfg.summary, None);
}

#[test]
fn serializes_the_model_key_for_every_turn() {
    let cfg = build_turn_config(
        &tuning(None, false),
        &CodexProviderTuning::default(),
        "gpt-5.5",
        "default",
    );
    let settings = serde_json::to_value(&cfg.collaboration_mode).unwrap()["settings"].clone();
    assert_eq!(settings["model"], "gpt-5.5");
    assert_eq!(settings["reasoning_effort"], serde_json::Value::Null);
    assert_eq!(settings["developer_instructions"], serde_json::Value::Null);
}

// --- collaboration mode ---

#[test]
fn sets_mode_plan_when_plan() {
    let cfg = build_turn_config(
        &tuning(None, false),
        &CodexProviderTuning::default(),
        "codex-mini-latest",
        "plan",
    );
    assert_eq!(cfg.collaboration_mode.mode, "plan");
}

#[test]
fn sets_mode_default_when_default() {
    let cfg = build_turn_config(
        &tuning(None, false),
        &CodexProviderTuning::default(),
        "codex-mini-latest",
        "default",
    );
    assert_eq!(cfg.collaboration_mode.mode, "default");
}

#[test]
fn threads_resolved_effort_into_settings_reasoning_effort() {
    let cfg = build_turn_config(
        &tuning(Some(EffortLevel::High), false),
        &CodexProviderTuning::default(),
        "codex-mini-latest",
        "default",
    );
    assert_eq!(
        cfg.collaboration_mode.settings.reasoning_effort,
        Some(EffortLevel::High)
    );
}

#[test]
fn uses_null_reasoning_effort_when_effort_null() {
    let cfg = build_turn_config(
        &tuning(None, false),
        &CodexProviderTuning::default(),
        "codex-mini-latest",
        "default",
    );
    assert_eq!(cfg.collaboration_mode.settings.reasoning_effort, None);
}
