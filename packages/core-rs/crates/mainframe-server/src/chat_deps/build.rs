use super::*;

pub struct ChatManagerParams {
    pub db: Db,
    pub adapters: Arc<AdapterRegistry>,
    pub background_tasks: Arc<BackgroundTaskTracker>,
    pub attachments: Arc<AttachmentStore>,
    pub push: Arc<PushService>,
    pub git: GitFactory,
    pub broadcast: broadcast::Sender<DaemonEvent>,
    pub launch: Arc<dyn LaunchStopper>,
    pub scope_tunnels: Arc<dyn ScopeTunnelStopper>,
    pub quota: Arc<QuotaManager>,
    pub claude_workflows: Arc<ClaudeWorkflowStore>,
    pub chat_surface: Option<Arc<dyn mainframe_chat::chat_surface::ChatSurface>>,
    pub data_dir: std::path::PathBuf,
}

pub fn build_chat_manager(params: ChatManagerParams) -> Arc<ChatManager> {
    let ChatManagerParams {
        db,
        adapters,
        background_tasks,
        attachments,
        push,
        git,
        broadcast,
        launch,
        scope_tunnels,
        quota,
        claude_workflows,
        chat_surface,
        data_dir,
    } = params;
    let raw = db.call_blocking(|db| db.settings.get("general", "notifications"));
    let config = match raw {
        Ok(raw) => mainframe_services::notifications::parse_notification_config(raw.as_deref()),
        Err(error) => {
            tracing::warn!(%error, "notification settings read failed at boot; using defaults");
            Default::default()
        }
    };
    let deps = Arc::new(DaemonChatDeps {
        notification_config: std::sync::RwLock::new(Arc::new(config)),
        db,
        adapters,
        background_tasks,
        attachments,
        push,
        git,
        broadcast,
        launch,
        scope_tunnels,
        quota,
        claude_external_session_cache: new_external_session_cache(),
        claude_workflows,
        data_dir,
    });
    let mut manager = ChatManager::new(deps.clone()).with_external_sessions(deps);
    if let Some(surface) = chat_surface {
        manager = manager.with_chat_surface(surface);
    }
    let manager = Arc::new(manager);
    manager.attach_self();
    manager
}
