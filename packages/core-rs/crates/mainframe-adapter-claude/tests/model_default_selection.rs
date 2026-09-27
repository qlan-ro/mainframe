#![allow(clippy::unwrap_used)]

use mainframe_adapter_claude::probe_models::extract_probe_payload;
use serde_json::json;

#[test]
fn default_catalog_keeps_a_pinned_model_separate_from_cli_inheritance() {
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
            { "value": "opus", "resolvedModel": "claude-opus-5-5" },
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
