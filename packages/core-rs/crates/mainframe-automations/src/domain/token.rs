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

/// Which producer family a value came from. Not on the wire: it exists so
/// `$name` derivation can prefix implicit outputs (`agent_result`) and read a
/// set-variable's user-typed name (tokens::variables).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TokenSourceKind {
    Builtin,
    Trigger,
    Agent,
    AskMe,
    Action,
    Item,
    Variable,
}

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
