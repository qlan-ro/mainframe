use super::transcript_ready::RestorationClaim;
use super::*;

struct RestoredHistory {
    canonical: Option<Vec<ChatMessage>>,
    changed: bool,
}

impl ChatLifecycleManager {
    pub(super) async fn do_load_chat(&self, chat_id: &str, mut ready: RestorationClaim) -> bool {
        let restored = self.restore_chat(chat_id, &mut ready).await;
        ready.finish();
        self.seed_worktree_baseline(chat_id).await;
        let Some(restored) = restored else {
            return false;
        };
        self.shared
            .deps
            .scan_loaded_history(chat_id, restored.canonical.as_deref())
            .await;
        restored.changed
    }

    async fn seed_worktree_baseline(&self, chat_id: &str) {
        let Some(chat) =
            storage_event!(self.shared, Some(chat_id); self.shared.deps.chats_get(chat_id))
        else {
            return;
        };
        if chat.status != ChatStatus::Active {
            return;
        }
        if let Some(project) = self.shared.deps.projects_get_path(&chat.project_id) {
            self.worktree_offers.seed_baseline(chat_id, &project).await;
        }
    }

    async fn restore_chat(
        &self,
        chat_id: &str,
        ready: &mut RestorationClaim,
    ) -> Option<RestoredHistory> {
        let prepared = self.prepare_load(chat_id).await;
        ready.track(self.get_active(chat_id));
        let (chat, effective_path) = prepared?;
        // Compose earlier segments even when the active session has no transcript.
        let composed = self.compose_history(chat_id).await;
        let canonical = composed.is_none();
        let own_id = chat.vendor_session_id.clone();
        // A pending fork snapshot can resume before the new session writes its own transcript.
        let fork_source = storage_event!(
            self.shared, Some(chat_id);
            self.shared.deps.get_pending_fork(chat_id),
            None
        )
        .map(|pending| pending.fork_source);
        if own_id.is_none() && fork_source.is_none() {
            return composed.map(|history| self.restore_snapshot(chat_id, Some(history), false));
        }

        let session = self.create_restore_session(&chat, effective_path, fork_source)?;

        let history = match composed {
            Some(history) => Some(history),
            None => history::load_session_history(chat_id, session.as_ref(), &self.shared).await,
        };
        Some(self.restore_snapshot(chat_id, history, canonical))
    }

    fn create_restore_session(
        &self,
        chat: &Chat,
        effective_path: String,
        fork_source: Option<mainframe_types::adapter::ForkSource>,
    ) -> Option<Arc<dyn mainframe_adapter_api::AdapterSession>> {
        let session = self.shared.deps.create_session(
            &chat.adapter_id,
            SessionOptions {
                project_path: effective_path,
                chat_id: chat.vendor_session_id.clone(),
                mainframe_chat_id: chat.id.clone(),
                session_file_path: chat.session_file_path.clone(),
                fork_source,
            },
        )?;
        if let Some(cell) = self.get_active(&chat.id) {
            cell.lock_recover().session = Some(session.clone());
        }
        Some(session)
    }

    fn restore_snapshot(
        &self,
        chat_id: &str,
        history: Option<(Vec<ChatMessage>, usize)>,
        canonical: bool,
    ) -> RestoredHistory {
        let (scan_history, cache_reloaded) = match history {
            Some((messages, active_from)) => {
                let (messages, changed) =
                    self.restore_loaded_history(chat_id, messages, active_from);
                (canonical.then_some(messages), changed)
            }
            None => (None, false),
        };
        if cache_reloaded {
            chat_surface::notify(
                self.chat_surface.get(),
                ChatSurfaceEvent::Resync {
                    chat_id: chat_id.to_string(),
                },
            );
        }
        RestoredHistory {
            canonical: scan_history,
            changed: cache_reloaded,
        }
    }

    fn restore_loaded_history(
        &self,
        chat_id: &str,
        messages: Vec<ChatMessage>,
        active_from: usize,
    ) -> (Vec<ChatMessage>, bool) {
        if messages.is_empty() {
            return (messages, false);
        }
        let (messages, changed) =
            history::restore_history(&mut self.shared.messages.lock_recover(), chat_id, messages);
        self.shared
            .permissions
            .lock_recover()
            .restore_pending_permission(chat_id, &messages[active_from.min(messages.len())..]);
        (messages, changed)
    }
}
