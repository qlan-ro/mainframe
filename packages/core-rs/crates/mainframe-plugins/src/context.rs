//! Assembles a plugin's capability surface. Each gated subsystem (db,
//! attachments, events, ui, adapters) is present only when its capability is
//! declared; otherwise a guard stands in whose use surfaces
//! `PluginError::CapabilityRequired`. This module also owns the behavioral
//! trait interfaces that `packages/types/src/plugin.ts` deferred to the plugins
//! crate (they carry method signatures / futures, not serde data).

use mainframe_types::sync::LockExt as _;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::BoxFuture;
use mainframe_types::chat::Chat;
use mainframe_types::events::DaemonEvent;
use mainframe_types::plugin::{
    ChatSummary, PluginAttachmentMeta, PluginCapability, PluginManifest, UiZone,
};
use rusqlite::types::Value as SqlValue;
use serde::Serialize;

use crate::PluginError;
use crate::attachment_context::FsAttachmentContext;
use crate::db_context::{PluginDatabaseContext, Row};
use crate::github_port::GitHubIssues;
use crate::services::build_chat_service;
use crate::ui_context::create_plugin_ui_context;

/// Event fan-out sink handed to every context (`emitEvent`).
pub type EmitSink = Arc<dyn Fn(DaemonEvent) + Send + Sync>;

/// A `notify()` payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotifyOptions {
    pub title: String,
    pub body: String,
    pub level: Option<String>,
}

/// An attachment upload body (`save(entityId, file)`).
#[derive(Debug, Clone)]
pub struct AttachmentUpload {
    pub filename: String,
    pub mime_type: String,
    /// Base64-encoded bytes.
    pub data: String,
    pub size_bytes: i64,
}

/// The `get()` result: `{ data, meta }`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentData {
    /// Base64-encoded bytes.
    pub data: String,
    pub meta: PluginAttachmentMeta,
}

/// `createChat(args)` input.
#[derive(Debug, Clone, Default)]
pub struct CreateChatArgs {
    pub project_id: String,
    pub adapter_id: Option<String>,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
}

/// `createChat` result (`{ chatId }`).
#[derive(Debug, Clone)]
pub struct CreateChatResult {
    pub chat_id: String,
}

// ─── Capability trait interfaces ─────────────────────────────────────────────

/// `PluginDatabaseContext` — per-plugin SQLite (`storage`).
pub trait PluginDatabase: Send + Sync {
    fn run_migration(&self, sql: String) -> BoxFuture<'_, Result<(), PluginError>>;
    fn execute(&self, sql: String, params: Vec<SqlValue>)
    -> BoxFuture<'_, Result<(), PluginError>>;
    fn query_all(
        &self,
        sql: String,
        params: Vec<SqlValue>,
    ) -> BoxFuture<'_, Result<Vec<Row>, PluginError>>;
    fn query_one(
        &self,
        sql: String,
        params: Vec<SqlValue>,
    ) -> BoxFuture<'_, Result<Option<Row>, PluginError>>;
}

/// `PluginAttachmentContext` — per-entity attachment storage (`storage`).
pub trait PluginAttachments: Send + Sync {
    fn save(
        &self,
        entity_id: &str,
        file: AttachmentUpload,
    ) -> BoxFuture<'_, Result<PluginAttachmentMeta, PluginError>>;
    fn get(
        &self,
        entity_id: &str,
        id: &str,
    ) -> BoxFuture<'_, Result<Option<AttachmentData>, PluginError>>;
    fn list(
        &self,
        entity_id: &str,
    ) -> BoxFuture<'_, Result<Vec<PluginAttachmentMeta>, PluginError>>;
    fn delete(&self, entity_id: &str, id: &str) -> BoxFuture<'_, Result<(), PluginError>>;
}

/// `PluginUIContext` — panel/action registration + notifications.
pub trait PluginUi: Send + Sync {
    fn add_panel(&self, zone: UiZone, label: &str, icon: Option<&str>) -> String;
    fn remove_panel(&self, id: Option<&str>);
    fn add_action(&self, id: &str, label: &str, shortcut: &str, icon: Option<&str>);
    fn remove_action(&self, id: &str);
    fn notify(&self, options: NotifyOptions);
}

/// `ChatServiceAPI` exposed to plugins.
pub trait ChatService: Send + Sync {
    fn list_chats(&self, project_id: &str) -> BoxFuture<'_, Result<Vec<ChatSummary>, PluginError>>;
    fn get_chat_by_id(
        &self,
        chat_id: &str,
    ) -> BoxFuture<'_, Result<Option<ChatSummary>, PluginError>>;
    /// Whether `chat:create` is declared (`ctx.services.chats.createChat` present).
    fn can_create_chat(&self) -> bool;
    fn create_chat(
        &self,
        args: CreateChatArgs,
    ) -> BoxFuture<'_, Result<CreateChatResult, PluginError>>;
}

/// The host database surface the context reads (the `DatabaseManager` slice the
/// TS `buildPluginContext` depends on). Synchronous, matching better-sqlite3;
/// the server implements it over its `Db` actor's `call_blocking` bridge.
pub trait PluginHostDb: Send + Sync {
    fn chats_list(&self, project_id: &str) -> Vec<Chat>;
    fn chats_get(&self, id: &str) -> Option<Chat>;
    fn chats_create(
        &self,
        project_id: &str,
        adapter_id: &str,
        model: Option<&str>,
        permission_mode: Option<&str>,
    ) -> Chat;
    fn settings_get(&self, category: &str, key: &str) -> Option<String>;
}

type UnloadFn = Box<dyn FnOnce() + Send>;

/// The assembled plugin context handed to `activate`.
pub struct PluginContext {
    pub manifest: PluginManifest,
    pub db: Arc<dyn PluginDatabase>,
    pub attachments: Arc<dyn PluginAttachments>,
    pub ui: Arc<dyn PluginUi>,
    pub chats: Arc<dyn ChatService>,
    pub github: Arc<dyn GitHubIssues>,
    on_unload: Mutex<Vec<UnloadFn>>,
}

impl PluginContext {
    /// `onUnload(fn)` — register a teardown callback.
    pub(crate) fn on_unload(&self, cb: impl FnOnce() + Send + 'static) {
        self.on_unload.lock_recover().push(Box::new(cb));
    }

    /// Drain and return the registered teardown callbacks (the manager runs them
    /// during `unloadAll`).
    pub(crate) fn take_unload_callbacks(&self) -> Vec<UnloadFn> {
        std::mem::take(&mut *self.on_unload.lock_recover())
    }
}

/// Dependencies for `buildPluginContext`.
pub struct PluginContextDeps {
    pub manifest: PluginManifest,
    pub plugin_dir: PathBuf,
    pub host_db: Arc<dyn PluginHostDb>,
    pub emit: EmitSink,
    /// The GitHub Issues port, exposed only when `http:outbound` is declared
    /// (D2). `None` when the daemon's automations engine failed to start.
    pub github: Option<Arc<dyn GitHubIssues>>,
}

/// `buildPluginContext(deps)`.
pub fn build_plugin_context(deps: PluginContextDeps) -> Result<Arc<PluginContext>, PluginError> {
    let caps = &deps.manifest.capabilities;
    let has = |cap: PluginCapability| caps.contains(&cap);

    let db: Arc<dyn PluginDatabase> = if has(PluginCapability::Storage) {
        Arc::new(PluginDatabaseContext::open(
            &deps.plugin_dir.join("data.db"),
        )?)
    } else {
        Arc::new(guards::GuardDb)
    };

    let attachments: Arc<dyn PluginAttachments> = if has(PluginCapability::Storage) {
        Arc::new(FsAttachmentContext::new(
            deps.plugin_dir.join("attachments"),
        ))
    } else {
        Arc::new(guards::GuardAttachments)
    };

    let ui: Arc<dyn PluginUi> =
        if has(PluginCapability::UiPanels) || has(PluginCapability::UiNotifications) {
            let host_db = Arc::clone(&deps.host_db);
            let gate = Box::new(move || plugin_notify_enabled(host_db.as_ref()));
            Arc::new(create_plugin_ui_context(
                &deps.manifest.id,
                Arc::clone(&deps.emit),
                Some(gate),
            ))
        } else {
            Arc::new(guards::NoopUi)
        };

    let chats = build_chat_service(
        &deps.manifest,
        Arc::clone(&deps.host_db),
        Arc::clone(&deps.emit),
    );
    let github: Arc<dyn GitHubIssues> = if has(PluginCapability::HttpOutbound) {
        match deps.github {
            Some(github) => github,
            None => Arc::new(guards::GuardGitHub::engine_unavailable()),
        }
    } else {
        Arc::new(guards::GuardGitHub::capability_missing())
    };

    Ok(Arc::new(PluginContext {
        manifest: deps.manifest,
        db,
        attachments,
        ui,
        chats,
        github,
        on_unload: Mutex::new(Vec::new()),
    }))
}

/// `readNotificationConfig(db).other.plugin` — the gate `createPluginUIContext`
/// receives.
fn plugin_notify_enabled(host_db: &dyn PluginHostDb) -> bool {
    struct Reader<'a>(&'a dyn PluginHostDb);
    impl mainframe_services::settings::SettingsReader for Reader<'_> {
        fn get(&self, ns: &str, key: &str) -> Option<String> {
            self.0.settings_get(ns, key)
        }
    }
    mainframe_services::notifications::read_notification_config(&Reader(host_db))
        .other
        .plugin
}

mod guards {
    use super::*;

    fn cap_err(cap: &str) -> PluginError {
        PluginError::CapabilityRequired(cap.to_string())
    }

    pub struct GuardDb;
    impl PluginDatabase for GuardDb {
        fn run_migration(&self, _sql: String) -> BoxFuture<'_, Result<(), PluginError>> {
            Box::pin(async { Err(cap_err("storage")) })
        }
        fn execute(
            &self,
            _sql: String,
            _p: Vec<SqlValue>,
        ) -> BoxFuture<'_, Result<(), PluginError>> {
            Box::pin(async { Err(cap_err("storage")) })
        }
        fn query_all(
            &self,
            _sql: String,
            _p: Vec<SqlValue>,
        ) -> BoxFuture<'_, Result<Vec<Row>, PluginError>> {
            Box::pin(async { Err(cap_err("storage")) })
        }
        fn query_one(
            &self,
            _sql: String,
            _p: Vec<SqlValue>,
        ) -> BoxFuture<'_, Result<Option<Row>, PluginError>> {
            Box::pin(async { Err(cap_err("storage")) })
        }
    }

    pub struct GuardAttachments;
    impl PluginAttachments for GuardAttachments {
        fn save(
            &self,
            _e: &str,
            _f: AttachmentUpload,
        ) -> BoxFuture<'_, Result<PluginAttachmentMeta, PluginError>> {
            Box::pin(async { Err(cap_err("storage")) })
        }
        fn get(
            &self,
            _e: &str,
            _id: &str,
        ) -> BoxFuture<'_, Result<Option<AttachmentData>, PluginError>> {
            Box::pin(async { Err(cap_err("storage")) })
        }
        fn list(&self, _e: &str) -> BoxFuture<'_, Result<Vec<PluginAttachmentMeta>, PluginError>> {
            Box::pin(async { Err(cap_err("storage")) })
        }
        fn delete(&self, _e: &str, _id: &str) -> BoxFuture<'_, Result<(), PluginError>> {
            Box::pin(async { Err(cap_err("storage")) })
        }
    }

    /// UI without `ui:panels`/`ui:notifications`. The TS throwing Proxy has no
    /// sync-fallible analogue here (these methods return no Result), so calls are
    /// logged and dropped — the one deviation from the throwing guard, on an
    /// untested misconfiguration path.
    pub struct NoopUi;
    impl PluginUi for NoopUi {
        fn add_panel(&self, _zone: UiZone, _label: &str, _icon: Option<&str>) -> String {
            tracing::error!("plugin ui used without 'ui:panels' or 'ui:notifications' capability");
            String::new()
        }
        fn remove_panel(&self, _id: Option<&str>) {}
        fn add_action(&self, _id: &str, _label: &str, _shortcut: &str, _icon: Option<&str>) {}
        fn remove_action(&self, _id: &str) {}
        fn notify(&self, _options: NotifyOptions) {}
    }

    pub use crate::github_port_guard::GuardGitHub;
}
