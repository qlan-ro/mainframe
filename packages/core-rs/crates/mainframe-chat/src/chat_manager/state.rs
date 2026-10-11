use super::*;
use crate::orchestration_hooks::OrchestrationSlot;

pub(crate) struct ChatShared {
    pub(crate) deps: Arc<dyn ChatManagerDeps>,
    pub(crate) active_chats: Registry,
    pub(crate) messages: Arc<Mutex<MessageCache>>,
    pub(crate) permissions: Arc<Mutex<PermissionManager>>,
    pub(crate) queued_refs: QueuedRefs,
    pub(crate) orchestration: OrchestrationSlot,
}

impl ChatShared {
    pub(crate) fn new(deps: Arc<dyn ChatManagerDeps>) -> Arc<Self> {
        Arc::new(Self {
            deps,
            active_chats: Arc::new(DashMap::new()),
            messages: Arc::new(Mutex::new(MessageCache::new())),
            permissions: Arc::new(Mutex::new(PermissionManager::new())),
            queued_refs: Arc::new(Mutex::new(Vec::new())),
            orchestration: OrchestrationSlot::default(),
        })
    }
}
