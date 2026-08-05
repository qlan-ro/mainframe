//! Shared harness for `run.rs`/`pairing.rs` tests (todo #286): unlike the
//! rest of `todos_github`, those two modules call the `GitHubIssues` port, so
//! `todos::tests::setup()` (which hardcodes `github: None`) can't be reused.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::extract::State;
use mainframe_types::chat::{Chat, Project};
use mainframe_types::plugin::{PluginCapability, PluginManifest};

use crate::context::{PluginContextDeps, PluginHostDb, build_plugin_context};
use crate::event_bus::PublicDaemonBus;
use crate::github_port::GitHubIssues;
use crate::{PluginContext, todos};

#[derive(Default)]
struct FakeHostDb {
    settings: Mutex<HashMap<(String, String), String>>,
}

impl PluginHostDb for FakeHostDb {
    fn chats_list(&self, _project_id: &str) -> Vec<Chat> {
        Vec::new()
    }
    fn chats_get(&self, _id: &str) -> Option<Chat> {
        None
    }
    fn chats_create(
        &self,
        _project_id: &str,
        _adapter_id: &str,
        _model: Option<&str>,
        _permission_mode: Option<&str>,
    ) -> Chat {
        unreachable!("the sync engine never creates chats")
    }
    fn settings_get(&self, category: &str, key: &str) -> Option<String> {
        self.settings
            .lock()
            .unwrap()
            .get(&(category.to_string(), key.to_string()))
            .cloned()
    }
    fn settings_set(&self, category: &str, key: &str, value: &str) {
        self.settings
            .lock()
            .unwrap()
            .insert((category.to_string(), key.to_string()), value.to_string());
    }
    fn projects_list(&self) -> Vec<Project> {
        Vec::new()
    }
    fn projects_get(&self, _id: &str) -> Option<Project> {
        None
    }
}

pub(crate) struct Harness {
    _dir: tempfile::TempDir,
    pub(crate) ctx: Arc<PluginContext>,
}

/// Builds a real `PluginContext` (storage + `http:outbound`) wired to
/// `github`, then runs `todos::activate` so both the base todos schema and
/// the additive GitHub tables exist.
pub(crate) async fn setup(github: Arc<dyn GitHubIssues>) -> Harness {
    let dir = tempfile::tempdir().unwrap();
    let host: Arc<dyn PluginHostDb> = Arc::new(FakeHostDb::default());
    let manifest = PluginManifest {
        id: "todos".into(),
        name: "TODO Kanban".into(),
        version: "1.0.0".into(),
        description: None,
        author: None,
        license: None,
        capabilities: vec![PluginCapability::Storage, PluginCapability::HttpOutbound],
        ui: None,
        adapter: None,
        commands: None,
    };
    let ctx = build_plugin_context(PluginContextDeps {
        manifest,
        plugin_dir: dir.path().to_path_buf(),
        host_db: host,
        daemon_bus: Arc::new(PublicDaemonBus::new()),
        emit: Arc::new(|_| {}),
        adapters: None,
        github: Some(github),
    })
    .unwrap();
    let _router = todos::activate(Arc::clone(&ctx)).await.unwrap();
    Harness { _dir: dir, ctx }
}

pub(crate) fn state(h: &Harness) -> State<Arc<PluginContext>> {
    State(Arc::clone(&h.ctx))
}
