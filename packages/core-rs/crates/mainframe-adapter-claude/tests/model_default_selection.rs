#![allow(clippy::unwrap_used)]

use mainframe_adapter_claude::probe_models::extract_probe_payload;
use mainframe_types::adapter::EffortLevel;
use serde_json::json;

#[test]
fn default_only_catalog_keeps_a_pinned_model_separate_from_cli_inheritance() {
    let event = json!({
        "type": "control_response",
        "response": { "response": { "models": [
            {
                "value": "default", "displayName": "Default",
                "description": "Opus 5.5 with 1M context · Most capable",
                "resolvedModel": "claude-opus-5-5",
                "supportedEffortLevels": ["low", "high"],
                "supportsFastMode": true
            },
            { "value": "fable", "resolvedModel": "claude-fable-5" }
        ]}}
    });
    let models = extract_probe_payload(&event).unwrap().models;
    let inherit = models.iter().find(|m| m.id == "default").unwrap();
    assert_eq!(inherit.label, "Use CLI setting");
    let opus = models.iter().find(|m| m.id == "claude-opus-5-5").unwrap();
    assert_eq!(opus.label, "Opus 5.5");
    assert_ne!(opus.is_default, Some(true));
    assert_eq!(opus.supported_efforts, inherit.supported_efforts);
    assert_eq!(opus.supports_fast, Some(true));
    assert_eq!(models.len(), 3);
}

#[test]
fn matching_explicit_alias_keeps_its_identity_and_capabilities() {
    let event = json!({
        "type": "control_response",
        "response": { "response": { "models": [
            {
                "value": "default", "displayName": "Default",
                "description": "Opus 5.5 with 1M context · Recommended",
                "resolvedModel": "claude-opus-5-5[1m]",
                "supportedEffortLevels": ["low", "high"],
                "supportsFastMode": true
            },
            {
                "value": "opus[1m]", "displayName": "Opus (1M context)",
                "description": "Opus 5.5 with 1M context · Explicit option",
                "resolvedModel": "claude-opus-5-5[1m]",
                "supportedEffortLevels": ["medium", "max"],
                "supportsAdaptiveThinking": true
            },
            {
                "value": "opus", "displayName": "Opus",
                "description": "Opus 5.5 with 200K context · Smaller context",
                "resolvedModel": "claude-opus-5-5"
            }
        ]}}
    });
    let models = extract_probe_payload(&event).unwrap().models;
    assert_eq!(
        models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
        ["default", "opus[1m]", "opus"]
    );
    let explicit = &models[1];
    assert_eq!(explicit.label, "Opus 5.5");
    assert_eq!(
        explicit.resolved_model.as_deref(),
        Some("claude-opus-5-5[1m]")
    );
    assert_eq!(
        explicit.supported_efforts,
        Some(vec![EffortLevel::Medium, EffortLevel::Max])
    );
    assert_eq!(explicit.supports_fast, None);
    assert_eq!(explicit.supports_adaptive_thinking, Some(true));
    assert_ne!(explicit.is_default, Some(true));
    assert_eq!(models[2].label, "Opus 5.5 with 200K context");
}
