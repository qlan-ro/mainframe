use super::*;

impl ChatLifecycleManager {
    pub(super) async fn do_load_chat(&self, chat_id: &str) -> bool {
        let Some((chat, effective_path)) = self.prepare_load(chat_id).await else {
            return false;
        };
        // Compose earlier segments even when the active session has no transcript.
        let composed = self.compose_history(chat_id).await;
        let canonical = composed.is_none();
        let own_id = chat.vendor_session_id.clone();
        // A pending fork snapshot can resume before the new session writes its own transcript.
        let fork_source = storage_event!(
            self.shared, Some(chat_id);
            self.shared.deps.get_pending_fork(chat_id),
            false
        )
        .map(|pending| pending.fork_source);
        if own_id.is_none() && fork_source.is_none() {
            return match composed {
                Some(history) => self.finish_load(chat_id, Some(history), false).await,
                None => false,
            };
        }

        let Some(session) = self.shared.deps.create_session(
            &chat.adapter_id,
            SessionOptions {
                project_path: effective_path,
                chat_id: own_id,
                mainframe_chat_id: chat_id.to_string(),
                session_file_path: chat.session_file_path.clone(),
                fork_source,
            },
        ) else {
            return false;
        };
        if let Some(cell) = self.get_active(chat_id) {
            cell.lock_recover().session = Some(session.clone());
        }

        let history = match composed {
            Some(history) => Some(history),
            None => history::load_session_history(chat_id, session.as_ref()).await,
        };
        self.finish_load(chat_id, history, canonical).await
    }

    async fn finish_load(
        &self,
        chat_id: &str,
        history: Option<(Vec<ChatMessage>, usize)>,
        canonical: bool,
    ) -> bool {
        let (scan_history, cache_reloaded) = match history {
            Some((messages, active_from)) => {
                let (messages, changed) =
                    self.restore_loaded_history(chat_id, messages, active_from);
                (canonical.then_some(messages), changed)
            }
            None => (None, false),
        };
        self.shared
            .deps
            .scan_loaded_history(chat_id, scan_history.as_deref())
            .await;
        if cache_reloaded {
            chat_surface::notify(
                self.chat_surface.get(),
                ChatSurfaceEvent::Resync {
                    chat_id: chat_id.to_string(),
                },
            );
        }
        cache_reloaded
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
