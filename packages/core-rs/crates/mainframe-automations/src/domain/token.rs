//! Flat token references (contract §1): `TokenRef {stepId, output, field?}`.
//! No tagged kinds — reserved stepIds distinguish trigger/builtin/current.

use serde::{Deserialize, Serialize};

/// Reserved stepId: the firing trigger's tokens (`result`/`chatId` for event
/// triggers, `payload` for webhooks; schedule triggers produce none).
pub const TOKEN_STEP_TRIGGER: &str = "trigger";
/// Reserved stepId: always-in-scope builtins (`today`, `now`).
pub const TOKEN_STEP_BUILTIN: &str = "builtin";
/// Reserved stepId: the Repeat block's current item, valid only inside the
/// block's own `steps`.
pub const TOKEN_STEP_CURRENT: &str = "current";

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TokenRef {
    pub step_id: String,
    pub output: String,
    /// Dot-path into a structured output (e.g. `pull_request.html_url`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T1.1), not a TS port
// confidence: high
// todos: 0
// notes: wire truth = packages/types/src/automation.ts TokenRef + contract §1.
