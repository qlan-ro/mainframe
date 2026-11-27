//! Assembles a plugin's capability surface. A gated subsystem (storage, ui,
//! GitHub) is wired up only when its capability is declared; otherwise the
//! accessor or a guard surfaces `PluginError::CapabilityRequired`.

use mainframe_types::sync::LockExt as _;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::BoxFuture;
use mainframe_types::chat::{Chat, NewChat};
use mainframe_types::events::DaemonEvent;
use mainframe_types::plugin::{PluginCapability, PluginManifest, UiZone};
use mainframe_types::settings_kv::SettingsKv;

use crate::PluginError;
use crate::attachment_context::FsAttachmentContext;
use crate::chat_service::ChatService;
use crate::db_context::{PluginSqlite, open_plugin_db};
use crate::github_port::GitHubIssues;
use crate::ui_context::UiContextImpl;

/// Event fan-out sink handed to every context.
pub type EmitSink = Arc<dyn Fn(DaemonEvent) + Send + Sync>;

/// A plugin notification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotifyOptions {
    pub title: String,
    pub body: String,
    pub level: Option<String>,
}

/// Panel and action registration plus notifications (`ui:panels`,
/// `ui:notifications`).
pub trait PluginUi: Send + Sync {
    fn add_panel(&self, zone: UiZone, label: &str, icon: Option<&str>) -> String;
    fn remove_panel(&self, id: Option<&str>);
    fn add_action(&self, id: &str, label: &str, shortcut: &str, icon: Option<&str>);
    fn remove_action(&self, id: &str);
    fn notify(&self, options: NotifyOptions) -> BoxFuture<'_, ()>;
}

/// The host database surface plugins use: creating a chat and reading the
/// provider defaults for it.
pub trait PluginHostDb: Send + Sync {
    fn create_chat(&self, new_chat: NewChat) -> BoxFuture<'_, Result<Chat, PluginError>>;
    /// The host settings store (provider defaults for `chat:create`).
    fn settings(&self) -> &dyn SettingsKv;
}

type UnloadFn = Box<dyn FnOnce() + Send>;

/// The assembled plugin context handed to `activate`.
pub struct PluginContext {
    pub manifest: PluginManifest,
    db: Option<PluginSqlite>,
    attachments: Option<FsAttachmentContext>,
    pub ui: Arc<dyn PluginUi>,
    pub chats: ChatService,
    pub github: Arc<dyn GitHubIssues>,
    on_unload: Mutex<Vec<UnloadFn>>,
}

impl PluginContext {
    /// The actor that owns this plugin's `data.db`. A plugin that does not
    /// declare `storage` never opens a database and gets
    /// `CapabilityRequired("storage")` here.
    pub fn db(&self) -> Result<&PluginSqlite, PluginError> {
        self.db.as_ref().ok_or_else(storage_required)
    }

    /// The plugin's per-entity attachment store, gated on `storage` like
    /// [`PluginContext::db`].
    pub fn attachments(&self) -> Result<&FsAttachmentContext, PluginError> {
        self.attachments.as_ref().ok_or_else(storage_required)
    }

    /// Registers a teardown callback that `PluginManager::unload_all` runs.
    pub(crate) fn on_unload(&self, cb: impl FnOnce() + Send + 'static) {
        self.on_unload.lock_recover().push(Box::new(cb));
    }

    pub(crate) fn take_unload_callbacks(&self) -> Vec<UnloadFn> {
        std::mem::take(&mut *self.on_unload.lock_recover())
    }
}

fn storage_required() -> PluginError {
    PluginError::CapabilityRequired("storage".to_string())
}

/// Dependencies for [`build_plugin_context`].
pub struct PluginContextDeps {
    pub manifest: PluginManifest,
    pub plugin_dir: PathBuf,
    pub host_db: Arc<dyn PluginHostDb>,
    pub emit: EmitSink,
    /// The GitHub Issues port, exposed only when `http:outbound` is declared.
    /// `None` when the daemon's automations engine failed to start.
    pub github: Option<Arc<dyn GitHubIssues>>,
}

pub fn build_plugin_context(deps: PluginContextDeps) -> Result<Arc<PluginContext>, PluginError> {
    let caps = &deps.manifest.capabilities;
    let has = |cap: PluginCapability| caps.contains(&cap);

    let storage = has(PluginCapability::Storage);
    let db = if storage {
        Some(open_plugin_db(&deps.plugin_dir.join("data.db"))?)
    } else {
        None
    };
    let attachments =
        storage.then(|| FsAttachmentContext::new(deps.plugin_dir.join("attachments")));

    let ui: Arc<dyn PluginUi> =
        if has(PluginCapability::UiPanels) || has(PluginCapability::UiNotifications) {
            let gate = notification_gate(Arc::clone(&deps.host_db));
            Arc::new(UiContextImpl::new(
                &deps.manifest.id,
                Arc::clone(&deps.emit),
                Some(gate),
            ))
        } else {
            Arc::new(NoopUi)
        };

    let chats = ChatService::new(
        has(PluginCapability::ChatCreate),
        Arc::clone(&deps.host_db),
        Arc::clone(&deps.emit),
    );
    let github: Arc<dyn GitHubIssues> = match (has(PluginCapability::HttpOutbound), deps.github) {
        (true, Some(github)) => github,
        (true, None) => Arc::new(GuardGitHub::engine_unavailable()),
        (false, _) => Arc::new(GuardGitHub::capability_missing()),
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

/// UI without `ui:panels` or `ui:notifications`. These methods return no
/// `Result`, so a call is logged and dropped instead of failing.
struct NoopUi;

impl PluginUi for NoopUi {
    fn add_panel(&self, _zone: UiZone, _label: &str, _icon: Option<&str>) -> String {
        tracing::error!("plugin ui used without 'ui:panels' or 'ui:notifications' capability");
        String::new()
    }
    fn remove_panel(&self, _id: Option<&str>) {}
    fn add_action(&self, _id: &str, _label: &str, _shortcut: &str, _icon: Option<&str>) {}
    fn remove_action(&self, _id: &str) {}
    fn notify(&self, _options: NotifyOptions) -> BoxFuture<'_, ()> {
        Box::pin(async {})
    }
}

use crate::github_port_guard::GuardGitHub;

mod notification;
use notification::notification_gate;
