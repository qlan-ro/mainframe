//! The `ClaudeAdapter` struct (the `Adapter` trait impl). The catalog surface it
//! serves — the static fallback list, the older-model merge and
//! `enrich_with_context_window` — lives in [`crate::models`].

use mainframe_types::sync::LockExt as _;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{
    Adapter, AdapterError, AdapterSession, BoxFuture, PlanModeActionHandler,
};
use mainframe_background_tasks::tracker::BackgroundTaskTracker;
use mainframe_claude_workflows::store::ClaudeWorkflowStore;
use mainframe_runtime::ResolvedPath;
use mainframe_types::adapter::{AdapterCapabilities, AdapterModel, SessionOptions};
use mainframe_types::display::ToolCategories;
use mainframe_types::transcript::TranscriptLocation;

use crate::models::{claude_models, enrich_with_context_window, merge_older_models};
use crate::plan_mode_handler::ClaudePlanModeHandler;
use crate::session::ClaudeSession;
use crate::title_generator::generate_claude_title;
use crate::transcript::{get_session_jsonl_path, locate_claude_transcript};
use mainframe_types::paths::encode_claude_project_path;

/// The adapter's display name (there is no manifest asset, so the string is
/// inlined).
const CLAUDE_ADAPTER_NAME: &str = "Claude Code";

fn tool_category(names: &[&str]) -> std::collections::HashSet<String> {
    names.iter().map(|s| s.to_string()).collect()
}

/// The native catalog — the live probe when one succeeded, the static list otherwise —
/// followed by the CLIProxyAPI section. Order is the picker's order.
fn merged_catalog(
    native: Option<Vec<AdapterModel>>,
    proxy: Vec<AdapterModel>,
) -> Vec<AdapterModel> {
    let mut models = native.unwrap_or_else(claude_models);
    models.extend(proxy);
    models
}

pub struct ClaudeAdapter {
    external_session_cache: crate::external_session_cache::ExternalSessionCache,
    background_tasks: Arc<BackgroundTaskTracker>,
    workflow_store: Arc<ClaudeWorkflowStore>,
    sessions: Arc<Mutex<HashMap<String, Arc<ClaudeSession>>>>,
    dynamic_models: Arc<Mutex<Option<Vec<AdapterModel>>>>,
    /// Models a local CLIProxyAPI serves, refreshed by each probe. Empty is the
    /// expected steady state — most installs have no proxy.
    proxy_models: Arc<Mutex<Vec<AdapterModel>>>,
    /// Boot-resolved login-shell `PATH`, applied to every spawned `claude` CLI so
    /// packaged builds find it outside the bare launchd `PATH`.
    resolved_path: ResolvedPath,
}

impl ClaudeAdapter {
    pub fn new(
        background_tasks: Arc<BackgroundTaskTracker>,
        workflow_store: Arc<ClaudeWorkflowStore>,
        resolved_path: ResolvedPath,
    ) -> Self {
        Self {
            external_session_cache: crate::external_session_cache::new_external_session_cache(),
            background_tasks,
            workflow_store,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            dynamic_models: Arc::new(Mutex::new(None)),
            proxy_models: Arc::new(Mutex::new(Vec::new())),
            resolved_path,
        }
    }
}

impl Default for ClaudeAdapter {
    fn default() -> Self {
        Self::new(
            Arc::new(BackgroundTaskTracker::new()),
            Arc::new(ClaudeWorkflowStore::new()),
            ResolvedPath::from_value("/usr/bin:/bin"),
        )
    }
}

mod contract;

#[cfg(test)]
mod tests;
