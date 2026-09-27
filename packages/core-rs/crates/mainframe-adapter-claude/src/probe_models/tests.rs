use super::*;
use serde_json::json;

fn model(id: &str, label: &str) -> AdapterModel {
    AdapterModel {
        id: id.to_string(),
        label: label.to_string(),
        description: None,
        resolved_model: None,
        context_window: None,
        is_default: None,
        is_older: None,
        group: None,
        supported_efforts: None,
        default_effort: None,
        supports_fast: None,
        supports_ultracode: None,
        supports_adaptive_thinking: None,
        supports_personality: None,
    }
}

#[test]
fn extract_probe_payload_reads_models_and_default_resolved_model() {
    let event = json!({
        "type": "control_response",
        "response": { "response": {
            "models": [{ "value": "default", "displayName": "Default", "resolvedModel": "claude-fable-5[1m]" }]
        }}
    });
    let out = extract_probe_payload(&event).unwrap();
    assert_eq!(out.models.len(), 2);
    assert_eq!(out.resolved_model.as_deref(), Some("claude-fable-5[1m]"));
}

#[test]
fn extract_probe_payload_returns_none_without_models_array() {
    let event = json!({ "type": "control_response", "response": { "response": {} } });
    assert!(extract_probe_payload(&event).is_none());
}

#[test]
fn extract_probe_payload_undefined_resolved_when_no_default() {
    let event = json!({
        "type": "control_response",
        "response": { "response": { "models": [{ "value": "claude-sonnet-5", "displayName": "Sonnet 5" }] } }
    });
    assert_eq!(extract_probe_payload(&event).unwrap().resolved_model, None);
}

// Ports the parse assertions of claude-probe-models.test.ts's "sends initialize
// request and parses model response" (the subprocess mock harness itself needs a
// process abstraction not present here; the parse path is what those assertions check).
#[test]
fn extract_probe_payload_maps_full_initialize_response() {
    let event = json!({
        "type": "control_response",
        "response": { "subtype": "success", "request_id": "test", "response": {
            "commands": [], "agents": [], "output_style": "concise",
            "available_output_styles": ["concise"],
            "models": [
                {
                    "value": "default",
                    "displayName": "Default (recommended)",
                    "description": "Opus 4.7 with 1M context",
                    "supportedEffortLevels": ["low", "medium", "high", "xhigh", "max"],
                    "supportsFastMode": true,
                    "supportsAdaptiveThinking": true
                },
                { "value": "claude-sonnet-4-6", "displayName": "Sonnet", "description": "Sonnet 4.6 · Best for everyday tasks" }
            ],
            "account": {}, "pid": 12345
        }}
    });
    let out = extract_probe_payload(&event).unwrap();
    assert_eq!(out.models.len(), 2);

    let mut expected0 = model("default", "Use CLI setting");
    expected0.description = Some("Opus 4.7 with 1M context".to_string());
    expected0.supported_efforts = Some(vec![
        EffortLevel::Low,
        EffortLevel::Medium,
        EffortLevel::High,
        EffortLevel::Xhigh,
        EffortLevel::Max,
    ]);
    expected0.supports_fast = Some(true);
    expected0.supports_adaptive_thinking = Some(true);
    expected0.supports_ultracode = Some(true);
    expected0.is_default = Some(true);
    assert_eq!(out.models[0], expected0);

    let mut expected1 = model("claude-sonnet-4-6", "Sonnet 4.6");
    expected1.description = Some("Sonnet 4.6 · Best for everyday tasks".to_string());
    assert_eq!(out.models[1], expected1);
}

#[test]
fn map_model_info_maps_efforts_fast_adaptive_derives_ultracode() {
    let m = map_model_info(&json!({
        "value": "default",
        "displayName": "Default",
        "description": "Opus 4.8 with 1M context · Most capable",
        "supportedEffortLevels": ["low", "medium", "high", "xhigh", "max"],
        "supportsAdaptiveThinking": true,
        "supportsFastMode": true
    }));
    assert_eq!(
        m.supported_efforts,
        Some(vec![
            EffortLevel::Low,
            EffortLevel::Medium,
            EffortLevel::High,
            EffortLevel::Xhigh,
            EffortLevel::Max,
        ])
    );
    assert_eq!(m.supports_fast, Some(true));
    assert_eq!(m.supports_adaptive_thinking, Some(true));
    assert_eq!(m.supports_ultracode, Some(true)); // derived from xhigh
}

#[test]
fn map_model_info_hides_ultracode_without_xhigh() {
    let m = map_model_info(&json!({
        "value": "sonnet",
        "displayName": "Sonnet",
        "description": "Sonnet 4.6",
        "supportedEffortLevels": ["low", "medium", "high", "max"],
        "supportsFastMode": true
    }));
    assert_eq!(m.supports_ultracode, None);
}

// Translated from the new probe-models.test.ts cases (#441).

#[test]
fn carries_each_entry_own_resolved_model_onto_the_mapped_model() {
    let event = json!({
        "type": "control_response",
        "response": { "response": { "models": [
            { "value": "sonnet", "displayName": "Sonnet", "resolvedModel": "claude-sonnet-5" },
            { "value": "claude-sonnet-5", "displayName": "Sonnet 5" },
        ]}}
    });
    let out = extract_probe_payload(&event).unwrap();
    assert_eq!(
        out.models[0].resolved_model.as_deref(),
        Some("claude-sonnet-5")
    );
    assert_eq!(out.models[1].resolved_model, None);
}

#[test]
fn keeps_inheritance_and_the_explicit_cli_alias() {
    let event = json!({
        "type": "control_response",
        "response": { "response": { "models": [
            {
                "value": "default",
                "displayName": "Default (recommended)",
                "description": "Opus 4.8 with 1M context · Best for everyday, complex tasks",
                "resolvedModel": "claude-opus-4-8[1m]"
            },
            {
                "value": "opus[1m]",
                "displayName": "Opus",
                "description": "Opus 4.8 with 1M context · Best for everyday, complex tasks",
                "resolvedModel": "claude-opus-4-8[1m]"
            },
            { "value": "sonnet", "displayName": "Sonnet", "resolvedModel": "claude-sonnet-5" },
        ]}}
    });
    let out = extract_probe_payload(&event).unwrap();
    assert_eq!(
        out.models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
        vec!["default", "opus[1m]", "sonnet"]
    );
    assert_eq!(out.models[0].label, "Use CLI setting");
    assert_eq!(out.models[0].is_default, Some(true));
}

#[test]
fn keeps_entries_with_distinct_or_unresolved_concrete_models() {
    let event = json!({
        "type": "control_response",
        "response": { "response": { "models": [
            { "value": "default", "displayName": "Default" },
            { "value": "opus[1m]", "displayName": "Opus", "resolvedModel": "claude-opus-4-8[1m]" },
            { "value": "sonnet", "displayName": "Sonnet", "resolvedModel": "claude-sonnet-5" },
        ]}}
    });
    assert_eq!(
        extract_probe_payload(&event)
            .unwrap()
            .models
            .iter()
            .map(|m| m.id.as_str())
            .collect::<Vec<_>>(),
        vec!["default", "opus[1m]", "sonnet"]
    );
}
