use super::*;
use crate::orchestration_hooks::OrchestrationSlot;
use mainframe_types::sync::LockExt as _;

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

    /// The live registry cell for `chat_id`, if the chat is active.
    pub(crate) fn active(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        self.active_chats.get(chat_id).map(|e| e.value().clone())
    }

    /// The chat as the live cell knows it, else as the store has it.
    pub(crate) fn chat_or_db(&self, chat_id: &str) -> Option<Chat> {
        self.active(chat_id)
            .map(|c| c.lock_recover().chat.clone())
            .or_else(|| self.deps.chats_get(chat_id))
    }
}
