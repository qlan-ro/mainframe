//! The per-read derivations every `Chat` leaving the manager carries, in one
//! place: the facade's reads and every sub-manager's `chat.updated` /
//! `chat.created` emit go through the same [`Enricher`].
use super::*;
use crate::orchestration_hooks::OrchestrationSlot;

#[derive(Clone)]
pub(super) struct Enricher {
    deps: Arc<dyn ChatManagerDeps>,
    permissions: Arc<Mutex<PermissionManager>>,
    orchestration: OrchestrationSlot,
}

impl Enricher {
    pub(super) fn new(
        deps: Arc<dyn ChatManagerDeps>,
        permissions: Arc<Mutex<PermissionManager>>,
        orchestration: OrchestrationSlot,
    ) -> Self {
        Self {
            deps,
            permissions,
            orchestration,
        }
    }

    pub(super) fn permissions(&self) -> &Arc<Mutex<PermissionManager>> {
        &self.permissions
    }

    pub(super) fn orchestration(&self) -> &OrchestrationSlot {
        &self.orchestration
    }

    fn has_pending(&self, chat_id: &str) -> bool {
        self.permissions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .has_pending(chat_id)
    }

    /// Sets every derived field: display status, background activity, the
    /// directory signals, the side chat's and delegated children's waiting
    /// state, and the agent outbox.
    pub(super) fn enrich(&self, chat: &mut Chat) {
        let has_pending = self.has_pending(&chat.id);
        // Rule 9 (todo #344): the side chat's gate shows on its parent.
        let side_chat_waiting = chat.side_chat_id.as_deref().map(|id| self.has_pending(id));
        let live = self.deps.tracker_list_live(&chat.id);
        let project_path = self.deps.projects_get_path(&chat.project_id);
        enrich_chat(
            chat,
            has_pending,
            &live,
            project_path.as_deref(),
            side_chat_waiting,
        );
        self.enrich_orchestration(chat);
    }

    /// `delegated_waiting` follows live gates, as `side_chat_waiting` does,
    /// so a child's permission prompt shows on its parent the moment it
    /// opens. `None` when the chat has no unfinished delegated tasks.
    fn enrich_orchestration(&self, chat: &mut Chat) {
        let lineage = &mut chat.orchestration;
        lineage.delegated_waiting = (!lineage.active_child_ids.is_empty()).then(|| {
            lineage
                .active_child_ids
                .iter()
                .any(|id| self.has_pending(id))
        });
        let outbox = self.orchestration.agent_outbox(&chat.id);
        lineage.agent_outbox = (!outbox.is_empty()).then_some(outbox);
    }

    /// Enrich `chat.updated` / `chat.created`, then emit through the raw
    /// `onEvent`.
    pub(super) fn emit(&self, mut event: DaemonEvent) {
        match &mut event {
            DaemonEvent::ChatUpdated { chat, .. } | DaemonEvent::ChatCreated { chat, .. } => {
                self.enrich(chat);
            }
            _ => {}
        }
        self.deps.emit_event(event);
    }
}
