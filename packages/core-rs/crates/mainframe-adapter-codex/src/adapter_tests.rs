use super::*;
use crate::types::ReasoningEffortOption;
use mainframe_types::adapter::EffortLevel;

#[test]
fn invalidate_catalog_drops_the_lifetime_model_cache() {
    let adapter = CodexAdapter::default();
    let m = ModelInfo {
        id: "gpt-6.1-sol".to_string(),
        display_name: None,
        description: None,
        hidden: None,
        is_default: None,
        supports_personality: None,
        additional_speed_tiers: None,
        default_reasoning_effort: None,
        supported_reasoning_efforts: None,
    };
    *adapter.cached_models.lock_recover() = Some(vec![map_codex_model(&m)]);
    assert_eq!(adapter.catalog().len(), 1);
    adapter.invalidate_catalog();
    assert!(adapter.catalog().is_empty());
}

#[test]
fn has_no_initial_transcript_path() {
    assert_eq!(
        CodexAdapter::default().initial_transcript_path("thread-1", "/proj"),
        None
    );
}

// --- model list mapping ---
#[test]
fn maps_efforts_default_fast_tier_personality_is_default() {
    let m = ModelInfo {
        id: "gpt-5.5".to_string(),
        display_name: Some("GPT-5.5".to_string()),
        description: Some("Frontier".to_string()),
        hidden: Some(false),
        is_default: Some(false),
        supports_personality: Some(true),
        additional_speed_tiers: Some(vec!["fast".to_string()]),
        default_reasoning_effort: Some(EffortLevel::Medium),
        supported_reasoning_efforts: Some(vec![
            ReasoningEffortOption {
                reasoning_effort: EffortLevel::Low,
                description: String::new(),
            },
            ReasoningEffortOption {
                reasoning_effort: EffortLevel::Medium,
                description: String::new(),
            },
            ReasoningEffortOption {
                reasoning_effort: EffortLevel::High,
                description: String::new(),
            },
            ReasoningEffortOption {
                reasoning_effort: EffortLevel::Xhigh,
                description: String::new(),
            },
        ]),
    };
    let model = map_codex_model(&m);
    assert_eq!(
        model.supported_efforts,
        Some(vec![
            EffortLevel::Low,
            EffortLevel::Medium,
            EffortLevel::High,
            EffortLevel::Xhigh
        ])
    );
    assert_eq!(model.default_effort, Some(EffortLevel::Medium));
    assert_eq!(model.supports_fast, Some(true));
    assert_eq!(model.supports_personality, Some(true));
}

#[test]
fn maps_a_known_and_an_unknown_model_id_to_a_non_null_context_window() {
    let known = ModelInfo {
        id: "gpt-5.5".to_string(),
        ..ModelInfo::default()
    };
    assert_eq!(map_codex_model(&known).context_window, Some(272_000));

    let unknown = ModelInfo {
        id: "some-future-model".to_string(),
        ..ModelInfo::default()
    };
    assert_eq!(
        map_codex_model(&unknown).context_window,
        Some(crate::context_window::DEFAULT_CODEX_CONTEXT_WINDOW)
    );
}

#[test]
fn deserializes_model_list_with_ultra_reasoning_effort() {
    let payload = serde_json::json!({
        "data": [{
            "id": "gpt-6-codex",
            "displayName": "GPT-6 Codex",
            "defaultReasoningEffort": "ultra",
            "supportedReasoningEfforts": [
                { "reasoningEffort": "high", "description": "" },
                { "reasoningEffort": "ultra", "description": "" }
            ]
        }]
    });
    let result: ModelListResult =
        serde_json::from_value(payload).expect("ultra reasoning effort must deserialize");
    let model = map_codex_model(&result.data[0]);
    assert_eq!(model.id, "gpt-6-codex");
    assert_eq!(model.default_effort, Some(EffortLevel::Ultra));
    assert_eq!(
        model.supported_efforts,
        Some(vec![EffortLevel::High, EffortLevel::Ultra])
    );
}
