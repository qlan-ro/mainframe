//! The fake host database and context builder behind the todos test harness.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use mainframe_types::chat::Chat;
use mainframe_types::events::DaemonEvent;
use mainframe_types::plugin::{PluginCapability, PluginManifest};
use mainframe_types::time::now_iso8601;
use serde_json::json;

use crate::context::{
    EmitSink, PluginContext, PluginContextDeps, PluginHostDb, build_plugin_context,
};

/// A recorded `chats_create` call: (projectId, adapterId, model, mode).
type CreatedChat = (String, String, Option<String>, Option<String>);

#[derive(Default)]
pub(super) struct FakeHostDb {
    pub(super) created: Mutex<Vec<CreatedChat>>,
    pub(super) settings: Mutex<HashMap<(String, String), String>>,
}

fn make_chat(id: &str, project_id: &str) -> Chat {
    let now = now_iso8601();
    serde_json::from_value(json!({
        "id": id,
        "adapterId": "claude",
        "projectId": project_id,
        "status": "active",
        "createdAt": now,
        "updatedAt": now,
        "totalCost": 0.0,
        "totalTokensInput": 0,
        "totalTokensOutput": 0,
        "lastContextTokensInput": 0,
    }))
    .unwrap()
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
        project_id: &str,
        adapter_id: &str,
        model: Option<&str>,
        permission_mode: Option<&str>,
    ) -> Chat {
        self.created.lock().unwrap().push((
            project_id.to_string(),
            adapter_id.to_string(),
            model.map(str::to_string),
            permission_mode.map(str::to_string),
        ));
        make_chat("chat-1", project_id)
    }
    fn settings_get(&self, category: &str, key: &str) -> Option<String> {
        self.settings
            .lock()
            .unwrap()
            .get(&(category.to_string(), key.to_string()))
            .cloned()
    }
}

pub(super) fn manifest(capabilities: Vec<PluginCapability>) -> PluginManifest {
    PluginManifest {
        id: "todos".into(),
        name: "TODO Kanban".into(),
        version: "1.0.0".into(),
        description: None,
        author: None,
        license: None,
        capabilities,
        ui: None,
        adapter: None,
        commands: None,
    }
}

/// A context on `plugin_dir` wired to `host`; events land in the returned sink.
pub(super) fn build_context(
    plugin_dir: &Path,
    capabilities: Vec<PluginCapability>,
    host: Arc<FakeHostDb>,
) -> (Arc<PluginContext>, Arc<Mutex<Vec<DaemonEvent>>>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let emit: EmitSink = Arc::new(move |e| sink.lock().unwrap().push(e));
    let ctx = build_plugin_context(PluginContextDeps {
        manifest: manifest(capabilities),
        plugin_dir: plugin_dir.to_path_buf(),
        host_db: host as Arc<dyn PluginHostDb>,
        emit,
        github: None,
    })
    .unwrap();
    (ctx, events)
}
