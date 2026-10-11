use super::*;
use serde_json::{Value, json};

fn roundtrip<T>(v: Value)
where
    T: serde::de::DeserializeOwned + serde::Serialize,
{
    let parsed: T = serde_json::from_value(v.clone()).unwrap();
    let back = serde_json::to_value(&parsed).unwrap();
    assert_eq!(v, back);
}

#[test]
fn control_request_full_tagged_suggestion() {
    let v = json!({
        "requestId": "req_001",
        "toolName": "Bash",
        "toolUseId": "toolu_01A",
        "input": { "command": "rm -rf /tmp/scratch" },
        "suggestions": [
            {
                "type": "addRules",
                "rules": [ { "toolName": "Bash", "ruleContent": "rm -rf /tmp/*" } ],
                "behavior": "allow",
                "destination": "session"
            }
        ],
        "decisionReason": "Destructive command outside project root"
    });
    roundtrip::<ControlRequest>(v);
}

#[test]
fn control_request_minimal_omits_reason() {
    let v = json!({
        "requestId": "req_001",
        "toolName": "Bash",
        "toolUseId": "toolu_01A",
        "input": { "command": "ls" },
        "suggestions": []
    });
    roundtrip::<ControlRequest>(v.clone());
    let s = serde_json::to_string(&serde_json::from_value::<ControlRequest>(v).unwrap()).unwrap();
    assert!(!s.contains("decisionReason"));
}

#[test]
fn control_update_set_mode_variant() {
    let v = json!({ "type": "setMode", "mode": "plan", "destination": "session" });
    roundtrip::<ControlUpdate>(v);
}

#[test]
fn adapter_capabilities_roundtrip_with_no_persistence() {
    roundtrip::<AdapterCapabilities>(json!({
        "planMode": true,
        "autoMode": false,
        "noPersistence": true,
        "fork": false
    }));
}

#[test]
fn adapter_capabilities_fork_absent_defaults_false() {
    let caps: AdapterCapabilities =
        serde_json::from_value(json!({ "planMode": true, "autoMode": false })).unwrap();
    assert!(!caps.fork);
    roundtrip::<AdapterCapabilities>(json!({
        "planMode": true,
        "autoMode": true,
        "noPersistence": false,
        "fork": true
    }));
}

#[test]
fn adapter_info_fork_unavailable_reason_roundtrips_and_omits_when_absent() {
    let v = json!({
        "id": "codex",
        "name": "Codex",
        "description": "Codex adapter",
        "installed": true,
        "models": [],
        "capabilities": { "planMode": false, "autoMode": false, "noPersistence": false, "fork": false },
        "forkUnavailableReason": "Forking Codex chats needs Codex CLI 0.143.0 or newer (installed: 0.140.0)"
    });
    roundtrip::<AdapterInfo>(v);

    let no_reason: AdapterInfo = serde_json::from_value(json!({
        "id": "claude",
        "name": "Claude",
        "description": "Claude adapter",
        "installed": true,
        "models": [],
        "capabilities": { "planMode": false, "autoMode": false, "fork": true }
    }))
    .unwrap();
    assert_eq!(no_reason.fork_unavailable_reason, None);
    let s = serde_json::to_string(&no_reason).unwrap();
    assert!(!s.contains("forkUnavailableReason"));
}

#[test]
fn adapter_capabilities_missing_no_persistence_defaults_false() {
    let parsed: AdapterCapabilities = serde_json::from_value(json!({
        "planMode": true,
        "autoMode": false
    }))
    .unwrap();
    assert!(!parsed.no_persistence);
}

#[test]
fn session_spawn_options_omits_no_persistence_when_absent() {
    let opts = SessionSpawnOptions {
        model: None,
        permission_mode: None,
        plan_mode: None,
        executable_path: None,
        system_prompt: None,
        tuning: None,
        small_fast_model: None,
        default_model: None,
        no_persistence: None,
        orchestration_mcp: None,
    };
    let v = serde_json::to_value(&opts).unwrap();
    assert!(v.as_object().unwrap().get("noPersistence").is_none());
}

#[test]
fn session_spawn_options_carries_no_persistence_true() {
    let opts = SessionSpawnOptions {
        model: None,
        permission_mode: None,
        plan_mode: None,
        executable_path: None,
        system_prompt: None,
        tuning: None,
        small_fast_model: None,
        default_model: None,
        no_persistence: Some(true),
        orchestration_mcp: None,
    };
    let v = serde_json::to_value(&opts).unwrap();
    assert_eq!(v["noPersistence"], json!(true));
}

#[test]
fn fork_source_camel_case_and_optional_resume_path() {
    roundtrip::<ForkSource>(json!({ "sourceSessionId": "sess_1" }));
    roundtrip::<ForkSource>(json!({
        "sourceSessionId": "sess_1",
        "resumePath": "/tmp/fork-snapshots/n1/sess_1.jsonl"
    }));
}

/// `lastTurnId` round-trips camelCase, is omitted when absent,
/// and an older payload with no such key still deserializes (`serde(default)`).
#[test]
fn fork_source_last_turn_id_roundtrips_and_is_optional() {
    roundtrip::<ForkSource>(json!({
        "sourceSessionId": "sess_1",
        "lastTurnId": "turn_9"
    }));
    let older_payload: ForkSource =
        serde_json::from_value(json!({ "sourceSessionId": "sess_1" })).unwrap();
    assert_eq!(older_payload.last_turn_id, None);

    let s = serde_json::to_string(&ForkSource {
        source_session_id: "sess_1".to_string(),
        resume_path: None,
        last_turn_id: None,
    })
    .unwrap();
    assert!(!s.contains("lastTurnId"));
}

#[test]
fn session_options_fork_source_omitted_when_absent() {
    let opts = SessionOptions {
        project_path: "/tmp".to_string(),
        chat_id: None,
        mainframe_chat_id: "mf_1".to_string(),
        session_file_path: None,
        fork_source: None,
    };
    let s = serde_json::to_string(&opts).unwrap();
    assert!(!s.contains("forkSource"));
}

#[test]
fn adapter_model_minimal_and_full() {
    roundtrip::<AdapterModel>(json!({ "id": "claude-sonnet-5", "label": "Sonnet 5" }));
    roundtrip::<AdapterModel>(json!({
        "id": "claude-opus-4-8",
        "label": "Opus 4.8",
        "description": "Most capable Claude model",
        "resolvedModel": "claude-opus-4-8-20260101",
        "contextWindow": 200000,
        "isDefault": true,
        "supportedEfforts": ["low", "medium", "high", "max"],
        "defaultEffort": "medium",
        "supportsFast": true,
        "supportsUltracode": true,
        "supportsAdaptiveThinking": true,
        "supportsPersonality": false
    }));
}

#[test]
fn effort_level_xhigh_serializes_without_underscore() {
    assert_eq!(
        serde_json::to_string(&EffortLevel::Xhigh).unwrap(),
        "\"xhigh\""
    );
    let e: EffortLevel = serde_json::from_str("\"xhigh\"").unwrap();
    assert_eq!(e, EffortLevel::Xhigh);
}

#[test]
fn effort_level_ultra_round_trips() {
    assert_eq!(
        serde_json::to_string(&EffortLevel::Ultra).unwrap(),
        "\"ultra\""
    );
    let e: EffortLevel = serde_json::from_str("\"ultra\"").unwrap();
    assert_eq!(e, EffortLevel::Ultra);
}

#[test]
fn external_session_page_null_next_offset() {
    let v = json!({ "sessions": [], "total": 0, "nextOffset": null });
    roundtrip::<ExternalSessionPage>(v);
}

#[test]
fn session_result_context_tokens_optional() {
    // absent contextTokens → None → omitted on the way back out
    // (SessionResult keys are snake_case except the camelCase contextTokens)
    roundtrip::<SessionResult>(json!({ "subtype": "success", "is_error": false }));
    // explicit number survives
    roundtrip::<SessionResult>(json!({ "contextTokens": 12345, "is_error": false }));
    // explicit null collapses to None (absent) on re-serialize
    let r: SessionResult = serde_json::from_value(json!({ "contextTokens": null })).unwrap();
    assert_eq!(r.context_tokens, None);
    assert!(!serde_json::to_string(&r).unwrap().contains("contextTokens"));
}

#[test]
fn detected_pr_source_enum() {
    roundtrip::<DetectedPr>(json!({
        "url": "https://github.com/qlan-ro/mainframe/pull/412",
        "owner": "qlan-ro",
        "repo": "mainframe",
        "number": 412,
        "source": "created"
    }));
}

#[test]
fn clamp_matches_ts_logic() {
    use EffortLevel as E;
    // requested supported → itself
    assert_eq!(
        clamp_effort_to_supported(E::High, &[E::Low, E::Medium, E::High], None),
        Some(E::High)
    );
    // not supported, default supported → default
    assert_eq!(
        clamp_effort_to_supported(E::Max, &[E::Low, E::Medium, E::High], Some(E::Medium)),
        Some(E::Medium)
    );
    // not supported, no usable default → highest ≤ requested
    assert_eq!(
        clamp_effort_to_supported(E::High, &[E::Low, E::Medium], None),
        Some(E::Medium)
    );
    // requested below everything → lowest supported
    assert_eq!(
        clamp_effort_to_supported(E::None, &[E::Medium, E::High], None),
        Some(E::Medium)
    );
    // empty → None
    assert_eq!(clamp_effort_to_supported(E::High, &[], None), None);
}
