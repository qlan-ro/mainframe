//! Shared harness for `run.rs`/`pairing.rs` tests: unlike the
//! rest of `todos_github`, those two modules call the `GitHubIssues` port, so
//! `todos::tests::setup()` (which hardcodes `github: None`) can't be reused.

use std::sync::Arc;

use axum::extract::State;
use mainframe_types::chat::Chat;
use mainframe_types::plugin::{PluginCapability, PluginManifest};
use mainframe_types::settings_kv::{MemorySettings, SettingsKv};

use crate::context::{PluginContextDeps, PluginHostDb, build_plugin_context};
use crate::github_port::GitHubIssues;
use crate::{PluginContext, todos};

#[derive(Default)]
struct FakeHostDb {
    settings: MemorySettings,
}

impl PluginHostDb for FakeHostDb {
    fn chats_list(&self, _project_id: &str) -> Result<Vec<Chat>, crate::PluginError> {
        Ok(Vec::new())
    }
    fn chats_get(&self, _id: &str) -> Result<Option<Chat>, crate::PluginError> {
        Ok(None)
    }
    fn chats_create(
        &self,
        _project_id: &str,
        _adapter_id: &str,
        _model: Option<&str>,
        _permission_mode: Option<&str>,
    ) -> Result<Chat, crate::PluginError> {
        unreachable!("the sync engine never creates chats")
    }
    fn settings(&self) -> &dyn SettingsKv {
        &self.settings
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
        emit: Arc::new(|_| {}),
        github: Some(github),
    })
    .unwrap();
    let _router = todos::activate(Arc::clone(&ctx)).await.unwrap();
    Harness { _dir: dir, ctx }
}

pub(crate) fn state(h: &Harness) -> State<Arc<PluginContext>> {
    State(Arc::clone(&h.ctx))
}
