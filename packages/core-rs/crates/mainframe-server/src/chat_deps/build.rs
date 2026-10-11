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
    let deps = Arc::new(DaemonChatDeps {
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
        chat_manager: OnceLock::new(),
        claude_workflows,
        data_dir,
    });
    let external_sessions = Arc::new(ExternalSessionService::new(deps.clone()));
    let mut manager = ChatManager::new(deps.clone()).with_external_sessions(external_sessions);
    if let Some(surface) = chat_surface {
        manager = manager.with_chat_surface(surface);
    }
    let manager = Arc::new(manager);
    manager.attach_self();
    let _ = deps.chat_manager.set(Arc::downgrade(&manager));
    manager
}
