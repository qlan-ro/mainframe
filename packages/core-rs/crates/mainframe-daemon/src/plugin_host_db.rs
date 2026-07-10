//! The daemon-side `PluginHostDb` — the `DatabaseManager` slice the plugin
//! contexts read, bridged onto the async `Db` actor via `call_blocking` (the same
//! SYNC-DB BRIDGE the `ChatManagerDeps` accessors use). In `index.ts` the
//! `PluginManager` closes over the raw `db`; here the actor stands in.

use mainframe_plugins::PluginHostDb;
use mainframe_runtime::time::now_iso8601;
use mainframe_server::db::Db;
use mainframe_types::chat::{Chat, ChatStatus, Project};
use serde_json::json;

pub struct DaemonPluginHostDb {
    db: Db,
}

impl DaemonPluginHostDb {
    pub fn new(db: Db) -> Self {
        Self { db }
    }
}

impl PluginHostDb for DaemonPluginHostDb {
    fn chats_list(&self, project_id: &str) -> Vec<Chat> {
        let pid = project_id.to_string();
        self.db
            .call_blocking(move |d| d.chats.list(&pid))
            .unwrap_or_default()
    }

    fn chats_get(&self, id: &str) -> Option<Chat> {
        let id = id.to_string();
        self.db
            .call_blocking(move |d| d.chats.get(&id))
            .ok()
            .flatten()
    }

    fn chats_create(
        &self,
        project_id: &str,
        adapter_id: &str,
        model: Option<&str>,
        permission_mode: Option<&str>,
    ) -> Chat {
        let (pid, aid) = (project_id.to_string(), adapter_id.to_string());
        let model = model.map(str::to_string);
        let mode = permission_mode.map(str::to_string);
        match self.db.call_blocking(move |d| {
            d.chats
                .create(&pid, &aid, model.as_deref(), mode.as_deref())
        }) {
            Ok(chat) => chat,
            Err(err) => {
                // The trait is infallible (mirrors better-sqlite3's synchronous
                // create); a DB failure has no error channel, so log + return an
                // unpersisted stub rather than crash the plugin request.
                tracing::error!(%err, project_id, adapter_id, "plugin chats.create failed");
                fallback_chat(project_id, adapter_id, permission_mode)
            }
        }
    }

    fn settings_get(&self, category: &str, key: &str) -> Option<String> {
        let (cat, key) = (category.to_string(), key.to_string());
        self.db
            .call_blocking(move |d| Ok(d.settings.get(&cat, &key).ok().flatten()))
            .ok()
            .flatten()
    }

    fn settings_set(&self, category: &str, key: &str, value: &str) {
        let (cat, k, val) = (category.to_string(), key.to_string(), value.to_string());
        if let Err(err) = self
            .db
            .call_blocking(move |d| d.settings.set(&cat, &k, &val))
        {
            tracing::warn!(%err, category, key, "plugin settings.set failed");
        }
    }

    fn projects_list(&self) -> Vec<Project> {
        self.db
            .call_blocking(|d| d.projects.list())
            .unwrap_or_default()
    }

    fn projects_get(&self, id: &str) -> Option<Project> {
        let id = id.to_string();
        self.db
            .call_blocking(move |d| d.projects.get(&id))
            .ok()
            .flatten()
    }
}

/// Minimal unpersisted `Chat` stub for the near-impossible create failure.
fn fallback_chat(project_id: &str, adapter_id: &str, permission_mode: Option<&str>) -> Chat {
    let now = now_iso8601();
    let stub_id = fallback_id();
    let mut value = json!({
        "id": stub_id,
        "adapterId": adapter_id,
        "projectId": project_id,
        "status": "active",
        "createdAt": now,
        "updatedAt": now,
        "totalCost": 0.0,
        "totalTokensInput": 0,
        "totalTokensOutput": 0,
        "lastContextTokensInput": 0,
    });
    if let Some(mode) = permission_mode.filter(|s| !s.is_empty()) {
        value["permissionMode"] = json!(mode);
    }
    serde_json::from_value(value).unwrap_or_else(|_| Chat {
        id: fallback_id(),
        adapter_id: adapter_id.to_string(),
        project_id: project_id.to_string(),
        title: None,
        claude_session_id: None,
        session_file_path: None,
        model: None,
        permission_mode: None,
        plan_mode: Some(false),
        status: ChatStatus::Active,
        created_at: now.clone(),
        updated_at: now,
        total_cost: 0.0,
        total_tokens_input: 0,
        total_tokens_output: 0,
        last_context_tokens_input: 0,
        context_files: None,
        mentions: None,
        modified_files: None,
        worktree_path: None,
        branch_name: None,
        process_state: None,
        display_status: None,
        is_running: None,
        worktree_missing: None,
        todos: None,
        pinned: None,
        effort: None,
        fast: None,
        ultracode: None,
        adaptive_thinking: None,
        detected_prs: None,
        tags: None,
    })
}

/// A best-effort unique id for the defensive create-failure stub (never hit in
/// normal operation, so a monotonic-clock value is sufficient).
fn fallback_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("fallback-{nanos}")
}

// PORT STATUS: (new — production PluginHostDb wiring for plugins/manager.ts `db`)
// confidence: high
// todos: 0
// notes: The one production PluginHostDb; every accessor bridges through the Db
// actor's call_blocking (SYNC-DB BRIDGE), one WAL connection. chats_create is
// infallible per the ported trait — a DB failure logs + returns an unpersisted stub.
