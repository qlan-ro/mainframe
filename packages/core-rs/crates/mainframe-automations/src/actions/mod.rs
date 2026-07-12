//! run_action registry + built-in actions (plan Phase 6). Every action is a
//! trait object behind the flat-id `ActionRegistry`; the run_action verb
//! (Node verbs/run-action.ts) renders ChipText params, resolves the
//! credential label, and hands this layer a JSON input object.

pub mod manifest;
pub mod registry;

use std::collections::BTreeMap;

use serde_json::Value;

pub use manifest::{ActionAuth, ActionGroup, ActionManifest, ActionOutput, ActionOutputType};
pub use registry::ActionRegistry;

use crate::credentials::Credentials;
use crate::engine::BoxFuture;
use crate::tokens::TokenValue;

/// What an action sees at execution time (Node actions/types.ts ActionCtx).
/// Cancellation is structural — the interpreter drops the walk future — so
/// no abort signal is threaded through.
pub struct ActionCtx {
    pub creds: Option<Credentials>,
    /// `runId:stepRef` — passed through to actions that support idempotency
    /// keys (e.g. HTTP).
    pub idempotency_key: String,
    /// Containment base for path-validated actions (run_command's `custom`
    /// cwd, A1). Resolved by the run_action verb via the ProjectRegistry
    /// port — never user text.
    pub project_root: String,
    /// Set when the run targets a worktree; run_command's `worktree` cwd
    /// mode reads this directly (daemon-computed, no containment needed).
    pub worktree_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct ActionError(pub String);

/// Named outputs, keyed by `TokenRef.output`. Empty map = no outputs.
pub type ActionOutputs = BTreeMap<String, TokenValue>;

pub trait Action: Send + Sync {
    fn manifest(&self) -> ActionManifest;
    fn execute<'a>(
        &'a self,
        params: &'a Value,
        ctx: &'a ActionCtx,
    ) -> BoxFuture<'a, Result<ActionOutputs, ActionError>>;
}

#[cfg(test)]
mod registry_tests;

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T6.2), not a TS port
// confidence: high
// todos: 0
// notes: built-ins (run_command/files/http) land in T6.3-T6.5; connectors +
//        the MCP catalog seam in Phase 7.
