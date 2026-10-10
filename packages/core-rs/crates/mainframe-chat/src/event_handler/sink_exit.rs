use super::*;

impl<D: EventHandlerDeps + 'static> SessionSinkImpl<D> {
    pub(super) fn handle_exit(&self, _code: Option<i32>) {
        self.finish_tool_timing();
        if self.take_partial_overlay() {
            self.emit_display();
        }

        let cell = self.deps.get_active_chat(&self.chat_id);
        let session_id = cell.as_ref().and_then(|c| {
            c.lock_recover()
                .session
                .as_ref()
                .map(|s| s.id().to_string())
        });
        if let Some(built) = &self.built_for_session_id
            && let Some(sid) = &session_id
            && sid != built
        {
            return;
        }
        let session_id = session_id.unwrap_or_default();
        debug!(session_id, chat_id = self.chat_id, "session exited");

        self.clear_exit_queue();

        self.deps.tracker_end_all_running(&self.chat_id);
        self.deps.workflow_runs_stop_all(&self.chat_id);

        self.clear_exit_state(cell);
        self.deps.emit_event(DaemonEvent::ProcessStopped {
            process_id: session_id,
        });
    }

    pub(super) fn handle_error(&self, error: mainframe_adapter_api::AdapterError) {
        self.deps.emit_event(DaemonEvent::Error {
            chat_id: Some(self.chat_id.clone()),
            error: error.to_string(),
        });
    }
    fn clear_exit_queue(&self) {
        let had_queued = self.messages.lock_recover().strip_all_queued(&self.chat_id);
        if had_queued {
            self.emit_display();
        }
        self.deps.on_queued_cleared(&self.chat_id);
        if had_queued {
            self.notify_surface(ChatSurfaceEvent::QueueChanged {
                chat_id: self.chat_id.clone(),
                refs: self.deps.get_queued_refs(&self.chat_id),
            });
        }
    }
    fn clear_exit_state(&self, cell: Option<Arc<Mutex<ActiveChat>>>) {
        if let Some(cell) = &cell {
            let (chat, was_working) = {
                let mut guard = cell.lock_recover();
                let was_working = guard.chat.process_state == Some(Some(ProcessState::Working));
                guard.chat.process_state = Some(None);
                (guard.chat.clone(), was_working)
            };
            self.deps.chats_update(
                &self.chat_id,
                &ChatPatch {
                    process_state: Some(None),
                    ..Default::default()
                },
            );
            self.deps
                .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });
            if was_working {
                self.notify_surface(ChatSurfaceEvent::TurnFinished {
                    chat_id: self.chat_id.clone(),
                    stop_reason: TurnStopReason::Error,
                });
            }
        }
    }
}
