//! Ported from `packages/core/src/plugins/builtin/codex/turn-config.ts`.

use mainframe_types::chat::ResolvedTuning;
use serde::{Deserialize, Serialize};

use crate::types::{CollaborationMode, CollaborationModeSettings};

/// Codex-only provider config — stays in the codex crate, never on shared spawn
/// options. `personality` ∈ {none, friendly, pragmatic}; `reasoning_summary` ∈
/// {auto, concise, detailed, none}.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexProviderTuning {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexTurnConfig {
    pub collaboration_mode: CollaborationMode,
    /// Only `Some("fast")` when the (model-clamped) fast toggle is on. Left `None`
    /// otherwise so turn/start omits service_tier and Codex uses the account
    /// default. We never send 'flex' (rejected by e.g. gpt-5.5).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

/// Builds the Codex turn/start config from ALREADY-RESOLVED inputs. It
/// deliberately does NOT re-gate on model capabilities (see the TS note): `fast`
/// is already clamped by resolveTuning and `codex.personality` is already gated by
/// the settings UI.
pub fn build_turn_config(
    tuning: &ResolvedTuning,
    codex: &CodexProviderTuning,
    model_id: Option<&str>,
    mode: &str,
) -> CodexTurnConfig {
    // `modelId ? { model: modelId } : {}` — omit the model key for both undefined
    // and empty-string ids (empty is falsy in JS) so Codex uses the account default.
    let model = model_id.filter(|m| !m.is_empty()).map(str::to_string);
    let mut cfg = CodexTurnConfig {
        collaboration_mode: CollaborationMode {
            mode: mode.to_string(),
            settings: CollaborationModeSettings {
                model,
                reasoning_effort: tuning.effort,
                developer_instructions: None,
            },
        },
        service_tier: None,
        personality: None,
        summary: None,
    };
    if tuning.fast {
        cfg.service_tier = Some("fast".to_string());
    }
    if let Some(personality) = &codex.personality {
        cfg.personality = Some(personality.clone());
    }
    if let Some(summary) = &codex.reasoning_summary {
        cfg.summary = Some(summary.clone());
    }
    cfg
}

#[cfg(test)]
mod tests {
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

    // --- turn-config.test.ts ---

    #[test]
    fn puts_effort_in_settings_fast_as_service_tier_codex_extras_top_level() {
        let cfg = build_turn_config(
            &tuning(Some(EffortLevel::High), true),
            &CodexProviderTuning {
                personality: Some("pragmatic".to_string()),
                reasoning_summary: Some("concise".to_string()),
            },
            Some("gpt-5.5"),
            "default",
        );
        assert_eq!(
            cfg.collaboration_mode.settings.model.as_deref(),
            Some("gpt-5.5")
        );
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
                Some("m"),
                "default"
            )
            .service_tier,
            None
        );
        assert_eq!(
            build_turn_config(
                &tuning(Some(EffortLevel::High), true),
                &CodexProviderTuning::default(),
                Some("m"),
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
            Some("m"),
            "default",
        );
        assert_eq!(cfg.personality, None);
        assert_eq!(cfg.summary, None);
    }

    #[test]
    fn omits_the_model_setting_when_no_model_is_selected() {
        // `it.each([undefined, ''])` — both an absent id and an empty string omit `model`.
        for model in [None, Some("")] {
            let cfg = build_turn_config(
                &tuning(Some(EffortLevel::High), false),
                &CodexProviderTuning::default(),
                model,
                "default",
            );
            assert_eq!(cfg.collaboration_mode.settings.model, None);
        }
    }

    // --- collaboration-mode.test.ts ---

    #[test]
    fn sets_mode_plan_when_plan() {
        let cfg = build_turn_config(
            &tuning(None, false),
            &CodexProviderTuning::default(),
            Some("codex-mini-latest"),
            "plan",
        );
        assert_eq!(cfg.collaboration_mode.mode, "plan");
    }

    #[test]
    fn sets_mode_default_when_default() {
        let cfg = build_turn_config(
            &tuning(None, false),
            &CodexProviderTuning::default(),
            Some("codex-mini-latest"),
            "default",
        );
        assert_eq!(cfg.collaboration_mode.mode, "default");
    }

    #[test]
    fn threads_resolved_effort_into_settings_reasoning_effort() {
        let cfg = build_turn_config(
            &tuning(Some(EffortLevel::High), false),
            &CodexProviderTuning::default(),
            Some("codex-mini-latest"),
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
            Some("codex-mini-latest"),
            "default",
        );
        assert_eq!(cfg.collaboration_mode.settings.reasoning_effort, None);
    }
}

// PORT STATUS: src/plugins/builtin/codex/turn-config.ts (50 lines)
// confidence: high
// todos: 0
// notes: #430 — model_id is now Option<&str>; the `model` key is omitted for both a
// notes: None id and an empty string (JS `modelId ? {model} : {}`), so Codex uses the
// notes: account default. reasoning_effort stays Option<EffortLevel> (serializes to the
// notes: Codex effort string, or explicit null). Ports turn-config.test.ts (incl. the
// notes: it.each([undefined,'']) omit-model case) + collaboration-mode.test.ts
// notes: assertion-for-assertion. `mode` is a &str ('plan'|'default').
