//! run_action registry + built-in actions. Every action is a trait object
//! behind the flat-id `ActionRegistry`; the run_action verb renders ChipText
//! params, resolves the credential label, and hands this layer a JSON input
//! object.

pub(crate) mod ado;
pub(crate) mod files;
pub(crate) mod github;
pub(crate) mod http;
pub(crate) mod http_action;
pub(crate) mod manifest;
pub(crate) mod notion;
pub(crate) mod registry;
pub(crate) mod run_command;
mod shell;

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::OnceLock;

use mainframe_types::BoxFuture;
use serde::de::DeserializeOwned;
use serde_json::Value;

pub use manifest::{ActionAuth, ActionGroup, ActionManifest, ActionOutput, ActionOutputType};
pub use registry::{ActionCatalogEntry, ActionRegistry};

use crate::credentials::Credentials;
use crate::tokens::TokenValue;

/// What an action sees at execution time. Cancellation is structural — the
/// interpreter drops the walk future — so no abort signal is threaded through.
pub struct ActionCtx {
    pub creds: Option<Credentials>,
    /// The label `creds` was resolved from (the step's `credential` field) —
    /// connector auth failures name it so the fix is actionable.
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

/// Whether an action can run at all right now. Everything self-contained is
/// always available; a connector that shells out to an external tool reports
/// the missing prerequisite so the catalog can mute it rather than offer a
/// step that is guaranteed to fail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActionAvailability {
    Available,
    /// One sentence naming the prerequisite and its remedy — shown verbatim
    /// in the catalog, so it is UI copy, not a log line.
    Unavailable(String),
}

pub trait Action: Send + Sync {
    fn manifest(&self) -> ActionManifest;
    fn execute<'a>(
        &'a self,
        params: &'a Value,
        ctx: &'a ActionCtx,
    ) -> BoxFuture<'a, Result<ActionOutputs, ActionError>>;

    fn availability<'a>(&'a self) -> BoxFuture<'a, ActionAvailability> {
        Box::pin(async { ActionAvailability::Available })
    }
}

/// Strict input parse — unknown fields rejected, with the error text
/// `invalid input for '<id>': …`.
pub(crate) fn parse_input<T: DeserializeOwned>(
    action_id: &str,
    params: &Value,
) -> Result<T, ActionError> {
    serde_json::from_value(params.clone())
        .map_err(|err| ActionError(format!("invalid input for '{action_id}': {err}")))
}

/// `~` expansion + absolute resolution: a leading `~` or `~/` becomes the
/// home dir; a relative path resolves against the process cwd.
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

/// The launch built-ins, in catalog order. MCP stays a catalog seam
/// (contract §9): nothing registers an `mcp:*` action here.
fn builtin_actions() -> Vec<Box<dyn Action>> {
    vec![
        Box::new(run_command::RunCommandAction),
        Box::new(files::FilesAppendAction),
        Box::new(files::FilesWriteAction),
        Box::new(files::FilesReadAction),
        Box::new(http_action::HttpRequestAction::new()),
    ]
}

/// Curated connectors, in catalog order.
fn curated_actions() -> Vec<Box<dyn Action>> {
    vec![
        Box::new(github::GithubCreatePrAction::new()),
        Box::new(github::GithubListPrsAction::new()),
        Box::new(notion::NotionAddRowAction::new()),
        Box::new(ado::AdoCreateItemAction::new()),
    ]
}

/// The built-ins alone, for tests that pin the builtin catalog.
#[cfg(test)]
pub(crate) fn register_builtin_actions(registry: &mut ActionRegistry) -> Result<(), ActionError> {
    builtin_actions()
        .into_iter()
        .try_for_each(|action| registry.register(action))
}

/// The launch catalog: built-ins, then curated connectors.
pub(crate) fn register_all_actions(registry: &mut ActionRegistry) -> Result<(), ActionError> {
    builtin_actions()
        .into_iter()
        .chain(curated_actions())
        .try_for_each(|action| registry.register(action))
}

/// The manifest of a launch action by id, for code that needs an action's
/// declared shape without a registry at hand (the validator's output table,
/// the `outputAs` lookup). Unknown and `mcp:*` ids return `None`.
pub(crate) fn known_manifest(action_id: &str) -> Option<&'static ActionManifest> {
    static MANIFESTS: OnceLock<Vec<ActionManifest>> = OnceLock::new();
    MANIFESTS
        .get_or_init(|| {
            builtin_actions()
                .into_iter()
                .chain(curated_actions())
                .map(|action| action.manifest())
                .collect()
        })
        .iter()
        .find(|manifest| manifest.id == action_id)
}

#[cfg(test)]
mod files_tests;

#[cfg(test)]
mod manifest_schema_tests;

#[cfg(test)]
mod github_tests;

#[cfg(test)]
mod http_tests;

#[cfg(test)]
mod notion_ado_tests;

#[cfg(test)]
mod registry_fields_tests;

#[cfg(test)]
mod registry_tests;

#[cfg(test)]
mod run_command_tests;

#[cfg(test)]
mod user_agent_tests;
