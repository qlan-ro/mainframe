//! run_action registry + built-in actions (plan Phase 6). Every action is a
//! trait object behind the flat-id `ActionRegistry`; the run_action verb
//! (Node verbs/run-action.ts) renders ChipText params, resolves the
//! credential label, and hands this layer a JSON input object.

pub mod files;
pub mod github;
pub mod http_action;
pub mod manifest;
mod paths;
pub mod registry;
pub mod run_command;
mod shell;

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::de::DeserializeOwned;
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
    /// The label `creds` was resolved from (the step's `credential` field) —
    /// connector auth failures name it so the fix is actionable (plan T7.1).
    pub credential_label: Option<String>,
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

const ERROR_BODY_SNIPPET_CHARS: usize = 500;

/// Connector HTTP failure (Node's `<op> failed (<status>): <500-char body>`),
/// plus the plan-T7.1 twist: an auth rejection names the credential label the
/// step used so the failure is actionable from the run timeline.
pub(crate) fn http_failure(op: &str, status: u16, ctx: &ActionCtx, body: &str) -> ActionError {
    let snippet: String = body.chars().take(ERROR_BODY_SNIPPET_CHARS).collect();
    if status == 401 || status == 403 {
        let cred = match &ctx.credential_label {
            Some(label) => format!("credential '{label}'"),
            None => "no credential configured".to_string(),
        };
        return ActionError(format!("{op} failed ({status}, {cred}): {snippet}"));
    }
    ActionError(format!("{op} failed ({status}): {snippet}"))
}

/// Strict input parse — unknown fields rejected (zod `.strict()` parity),
/// with the Node verb's error text (`invalid input for '<id>': …`).
pub(crate) fn parse_input<T: DeserializeOwned>(
    action_id: &str,
    params: &Value,
) -> Result<T, ActionError> {
    serde_json::from_value(params.clone())
        .map_err(|err| ActionError(format!("invalid input for '{action_id}': {err}")))
}

/// `~` expansion + absolute resolution (Node verbs/run-action.ts
/// resolvePath): a leading `~` or `~/` becomes the home dir; a relative
/// path resolves against the process cwd, mirroring `path.resolve`.
pub(crate) fn expand_user_path(path: &str) -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        if path == "~" {
            return home;
        }
        if let Some(rest) = path.strip_prefix("~/") {
            return home.join(rest);
        }
    }
    let p = PathBuf::from(path);
    if p.is_absolute() {
        p
    } else {
        std::env::current_dir().map(|cwd| cwd.join(&p)).unwrap_or(p)
    }
}

/// Registers every launch built-in (Node actions/register-all.ts). MCP stays
/// a catalog seam (contract §9) — nothing registers an `mcp:*` action here.
pub fn register_builtin_actions(registry: &mut ActionRegistry) -> Result<(), ActionError> {
    registry.register(Box::new(run_command::RunCommandAction))?;
    registry.register(Box::new(files::FilesAppendAction))?;
    registry.register(Box::new(files::FilesWriteAction))?;
    registry.register(Box::new(files::FilesReadAction))?;
    registry.register(Box::new(http_action::HttpRequestAction::new()))?;
    Ok(())
}

/// Curated connectors (plan Phase 7).
pub fn register_curated_actions(registry: &mut ActionRegistry) -> Result<(), ActionError> {
    registry.register(Box::new(github::GithubCreatePrAction::new()))?;
    registry.register(Box::new(github::GithubListPrsAction::new()))?;
    Ok(())
}

/// The launch catalog: built-ins + curated connectors, in Node's
/// register-all.ts order.
pub fn register_all_actions(registry: &mut ActionRegistry) -> Result<(), ActionError> {
    register_builtin_actions(registry)?;
    register_curated_actions(registry)?;
    Ok(())
}

#[cfg(test)]
mod files_tests;

#[cfg(test)]
mod github_tests;

#[cfg(test)]
mod http_tests;

#[cfg(test)]
mod registry_tests;

#[cfg(test)]
mod run_command_tests;

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T6.2), not a TS port
// confidence: high
// todos: 0
// notes: built-ins (run_command/files/http) land in T6.3-T6.5; connectors +
//        the MCP catalog seam in Phase 7.
