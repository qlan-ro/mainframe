use super::transcript_ready::RestorationClaim;
use super::*;

/// Why a released history could not come back.
#[derive(Debug)]
enum RestoreFailure {
    /// The chat left the registry meanwhile (offloaded or ended).
    Gone,
    /// The chat has no session whose transcript could be read.
    NoTranscript,
    /// Reading the transcript failed.
    Unreadable,
}

struct RestoredHistory {
    canonical: Option<Vec<ChatMessage>>,
    changed: bool,
    files: Option<mainframe_adapter_api::CollectedHistoryFiles>,
}

impl ChatLifecycleManager {
    pub(super) async fn do_load_chat(&self, chat_id: &str, mut ready: RestorationClaim) -> bool {
        if ready.restores_released() {
            // The cell, its worktree baseline and its history scan all
            // outlived the release; only the history comes back.
            let restored = self.restore_released(chat_id).await;
            ready.finish();
            return match restored {
                Ok(restored) => restored.changed,
                Err(failure) => {
                    warn!(chat_id, reason = ?failure, "released history restore failed");
                    false
                }
            };
        }
        let restored = self.restore_chat(chat_id, &mut ready).await;
        ready.finish();
        self.seed_worktree_baseline(chat_id).await;
        let Some(restored) = restored else {
            return false;
        };
        self.shared
            .deps
            .scan_loaded_history(chat_id, restored.canonical.as_deref(), restored.files)
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
        let read_from = self.shared.messages.lock_recover().history_epoch(chat_id);
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
            return composed
                .map(|history| self.restore_snapshot(chat_id, Some(history), false, read_from));
        }

        let session = self.create_restore_session(&chat, effective_path, fork_source)?;

        let history = match composed {
            Some(history) => Some(history),
            None => history::load_session_history(chat_id, session.as_ref(), &self.shared).await,
        };
        let mut restored = self.restore_snapshot(chat_id, history, canonical, read_from);
        restored.files = session.take_history_files();
        Some(restored)
    }

    /// [`Self::restore_chat`] for a chat whose history the idle release
    /// dropped: the live cell and its CLI session stay, so the history is read
    /// through a stateless session that never replaces the live one. An empty
    /// history read successfully is installed too, so the chat is no longer
    /// released; a failed read leaves it released for the caller to report.
    async fn restore_released(&self, chat_id: &str) -> Result<RestoredHistory, RestoreFailure> {
        let read_from = self.shared.messages.lock_recover().history_epoch(chat_id);
        let cell = self.get_active(chat_id).ok_or(RestoreFailure::Gone)?;
        let chat = cell.lock_recover().chat.clone();
        let composed = self.compose_history(chat_id).await;
        let canonical = composed.is_none();
        let (messages, active_from) = match composed {
            Some(history) => history,
            None => {
                let session =
                    crate::chat_manager::build_history_session(&self.shared.deps, &chat, chat_id)
                        .ok_or(RestoreFailure::NoTranscript)?;
                history::load_session_history(chat_id, session.as_ref(), &self.shared)
                    .await
                    .ok_or(RestoreFailure::Unreadable)?
            }
        };
        if messages.is_empty() {
            let mut cache = self.shared.messages.lock_recover();
            cache.install_history(chat_id, read_from, messages);
            return Ok(RestoredHistory {
                canonical: None,
                changed: false,
                files: None,
            });
        }
        Ok(self.restore_snapshot(chat_id, Some((messages, active_from)), canonical, read_from))
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
        read_from: u64,
    ) -> RestoredHistory {
        let cold = self.shared.messages.lock_recover().get(chat_id).is_none();
        let window = self.shared.history_cache.take_window(chat_id);
        let mut window_held = false;
        let (scan_history, cache_reloaded) = match history {
            Some((messages, active_from)) => {
                let (messages, changed) =
                    self.restore_loaded_history(chat_id, messages, active_from, read_from);
                // A window read from pages carries no permission gate. When the
                // full history restores one, the client must replay to see it.
                let gated = self.shared.permissions.lock_recover().has_pending(chat_id);
                if let Some(window) = window.as_deref().filter(|_| changed && !gated) {
                    window_held = self.window_held(chat_id, window, &messages);
                }
                (canonical.then_some(messages), changed)
            }
            None => (None, false),
        };
        let served = self.shared.history_cache.consume_served(chat_id) || window_held;
        if cache_reloaded && !(cold && served) {
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
            files: None,
        }
    }

    /// Whether the client's paged first window is the tail of the history that
    /// just loaded in full, so nothing needs replaying.
    fn window_held(
        &self,
        chat_id: &str,
        window: &[crate::window_marker::Mark],
        full: &[ChatMessage],
    ) -> bool {
        let categories = self.shared.deps.get_tool_categories(chat_id);
        let display =
            self.shared
                .deps
                .prepare_messages_for_client(chat_id, full, categories.as_ref());
        crate::window_marker::matches_tail(window, &display)
    }

    fn restore_loaded_history(
        &self,
        chat_id: &str,
        messages: Vec<ChatMessage>,
        active_from: usize,
        read_from: u64,
    ) -> (Vec<ChatMessage>, bool) {
        if messages.is_empty() {
            return (messages, false);
        }
        let (messages, changed) = history::restore_history(
            &mut self.shared.messages.lock_recover(),
            chat_id,
            messages,
            read_from,
        );
        self.shared
            .permissions
            .lock_recover()
            .restore_pending_permission(chat_id, &messages[active_from.min(messages.len())..]);
        self.shared.mark_history_restored(chat_id);
        (messages, changed)
    }
}
