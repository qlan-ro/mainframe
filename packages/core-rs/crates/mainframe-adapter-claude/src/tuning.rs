//! Ported from `packages/core/src/plugins/builtin/claude/tuning.ts`.

use mainframe_types::adapter::TUNABLE_FEATURES;
use mainframe_types::chat::ResolvedTuning;
use serde_json::{Map, Value};

/// Input is a complete `ResolvedTuning` (no undefined). Emit all three booleans;
/// omit `effortLevel` only when the model has no effort control (`effort === null`).
///
/// The TS returns `Record<string, unknown>`; the Rust equivalent is a
/// `serde_json::Map` (the object body of the `apply_flag_settings` control_request
/// `settings` field).
pub fn tuning_to_flag_settings(t: &ResolvedTuning) -> Map<String, Value> {
    let mut s: Map<String, Value> = Map::new();
    if let Some(effort) = t.effort {
        s.insert(
            "effortLevel".to_string(),
            serde_json::to_value(effort).unwrap_or(Value::Null),
        );
    }
    for f in TUNABLE_FEATURES.iter() {
        // `s[f.claudeSetting] = t[f.key]` — ResolvedTuning is a struct in Rust, so
        // the JS dynamic index maps to a match on the (fixed) feature keys.
        let val = match f.key {
            "fast" => t.fast,
            "ultracode" => t.ultracode,
            "adaptiveThinking" => t.adaptive_thinking,
            _ => false,
        };
        s.insert(f.claude_setting.to_string(), Value::Bool(val));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::adapter::EffortLevel;
    use serde_json::json;

    #[test]
    fn maps_a_resolved_tuning_to_flag_settings_keys() {
        let out = tuning_to_flag_settings(&ResolvedTuning {
            effort: Some(EffortLevel::Xhigh),
            fast: true,
            ultracode: false,
            adaptive_thinking: true,
        });
        assert_eq!(
            Value::Object(out),
            json!({ "effortLevel": "xhigh", "fastMode": true, "ultracode": false, "alwaysThinkingEnabled": true })
        );
    }

    #[test]
    fn omits_effort_level_when_the_model_has_no_effort_control() {
        let out = tuning_to_flag_settings(&ResolvedTuning {
            effort: None,
            fast: true,
            ultracode: false,
            adaptive_thinking: false,
        });
        assert_eq!(
            Value::Object(out),
            json!({ "fastMode": true, "ultracode": false, "alwaysThinkingEnabled": false })
        );
    }
}

// PORT STATUS: src/plugins/builtin/claude/tuning.ts (11 lines)
// confidence: high
// todos: 0
// notes: returns serde_json::Map (the TS Record<string, unknown>); the JS dynamic
// notes: `t[f.key]` index becomes a match on the three fixed TUNABLE_FEATURES keys.
