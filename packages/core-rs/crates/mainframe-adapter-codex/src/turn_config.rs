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
pub(crate) fn build_turn_config(
    tuning: &ResolvedTuning,
    codex: &CodexProviderTuning,
    model: &str,
    mode: &str,
) -> CodexTurnConfig {
    let mut cfg = CodexTurnConfig {
        collaboration_mode: CollaborationMode {
            mode: mode.to_string(),
            settings: CollaborationModeSettings {
                model: model.to_string(),
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
#[path = "turn_config_tests.rs"]
mod tests;
