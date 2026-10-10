use super::*;

impl<D: EventHandlerDeps + 'static> SessionSinkImpl<D> {
    pub(super) fn handle_result(&self, data: SessionResult) {
        if self.take_partial_overlay() {
            self.emit_display();
        }
        let Some(cell) = self.deps.get_active_chat(&self.chat_id) else {
            return;
        };
        self.retire_fork();
        let cost = data.total_cost_usd.unwrap_or(0.0);
        let totals = self.result_totals(&cell, &data);
        let now = now_iso8601();
        let refs_after = self.reconcile_result_queue();
        self.persist_result(&cell, &data, totals, refs_after.len(), now);
        self.record_segment_result(&data);
        let (reason, was_interrupted, is_error) = self.result_reason(&data);
        self.emit_result_state(&cell, reason, was_interrupted, is_error);
        self.emit_turn_duration(&cell);
        self.result_notifications(&data, cost, was_interrupted, is_error);
    }

    fn retire_fork(&self) {
        if let Some(pending) = self.deps.get_pending_fork(&self.chat_id) {
            self.deps.clear_pending_fork(&self.chat_id);
            let chat_id = self.chat_id.clone();
            let snapshot_dir = pending.snapshot_dir;
            tokio::spawn(async move {
                if let Err(err) = tokio::fs::remove_dir_all(&snapshot_dir).await
                    && err.kind() != std::io::ErrorKind::NotFound
                {
                    warn!(
                        %err,
                        chat_id,
                        snapshot_dir,
                        "failed to remove a retired fork's snapshot directory"
                    );
                }
            });
        }
    }
    fn result_totals(
        &self,
        cell: &Arc<Mutex<ActiveChat>>,
        data: &SessionResult,
    ) -> (f64, i64, i64) {
        let cost = data.total_cost_usd.unwrap_or(0.0);
        let tokens_input = data
            .usage
            .as_ref()
            .and_then(|u| u.input_tokens)
            .unwrap_or(0);
        let tokens_output = data
            .usage
            .as_ref()
            .and_then(|u| u.output_tokens)
            .unwrap_or(0);

        {
            let guard = cell.lock_recover();
            (
                guard.chat.total_cost + cost,
                guard.chat.total_tokens_input + tokens_input,
                guard.chat.total_tokens_output + tokens_output,
            )
        }
    }
    fn persist_result(
        &self,
        cell: &Arc<Mutex<ActiveChat>>,
        data: &SessionResult,
        totals: (f64, i64, i64),
        queue_remaining: usize,
        now: String,
    ) {
        let next_process_state = if queue_remaining > 0 {
            ProcessState::Working
        } else {
            ProcessState::Idle
        };

        // Context size: prefer the adapter's explicit per-turn report
        // (`contextTokens`; None = "unknown this turn — keep the stored value").
        // Each adapter resolves the value at its source: claude sends the last
        // parent assistant usage (or None when unknown), and Codex sends this
        // turn's raw input usage. So None always means
        // "keep stored" here; a zero must never clobber a real stored size.
        let context_update: Option<i64> = data.context_tokens.filter(|&v| v > 0);

        self.deps.chats_update(
            &self.chat_id,
            &ChatPatch {
                total_cost: Some(totals.0),
                total_tokens_input: Some(totals.1),
                total_tokens_output: Some(totals.2),
                last_context_tokens_input: context_update,
                process_state: Some(Some(next_process_state)),
                updated_at: Some(now.clone()),
                ..Default::default()
            },
        );
        {
            let mut guard = cell.lock_recover();
            guard.chat.total_cost = totals.0;
            guard.chat.total_tokens_input = totals.1;
            guard.chat.total_tokens_output = totals.2;
            if let Some(v) = context_update {
                guard.chat.last_context_tokens_input = v;
            }
            guard.chat.process_state = Some(Some(next_process_state));
            guard.chat.updated_at = now;
        }
    }
    fn result_reason(&self, data: &SessionResult) -> (ChatUpdatedReason, bool, bool) {
        let was_interrupted = self
            .permissions
            .lock_recover()
            .clear_interrupted(&self.chat_id);
        self.permissions.lock_recover().clear(&self.chat_id);

        let is_error = data.subtype.as_deref() == Some("error_during_execution")
            && data.is_error != Some(false);
        if was_interrupted || is_error {
            self.finish_tool_timing();
        }
        let reason = if was_interrupted {
            ChatUpdatedReason::Interrupted
        } else if is_error {
            ChatUpdatedReason::Error
        } else {
            ChatUpdatedReason::Completed
        };
        (reason, was_interrupted, is_error)
    }
    fn emit_result_state(
        &self,
        cell: &Arc<Mutex<ActiveChat>>,
        reason: ChatUpdatedReason,
        was_interrupted: bool,
        is_error: bool,
    ) {
        let chat = cell.lock_recover().chat.clone();
        debug!(
            chat_id = self.chat_id,
            ?reason,
            was_interrupted,
            is_error,
            "onResult: emitting chat.updated with processState=idle"
        );
        self.deps.emit_event(DaemonEvent::ChatUpdated {
            chat,
            reason: Some(reason),
        });
        self.notify_surface(ChatSurfaceEvent::TurnFinished {
            chat_id: self.chat_id.clone(),
            stop_reason: match reason {
                ChatUpdatedReason::Interrupted => TurnStopReason::Cancelled,
                ChatUpdatedReason::Error => TurnStopReason::Error,
                ChatUpdatedReason::Completed => TurnStopReason::Completed,
            },
        });
    }
    fn emit_turn_duration(&self, cell: &Arc<Mutex<ActiveChat>>) {
        let turn_started_at = cell.lock_recover().turn_started_at.take();
        if let Some(started) = turn_started_at {
            let turn_duration_ms = now_ms() - started;
            let mut md: HashMap<String, serde_json::Value> = HashMap::new();
            md.insert(
                "turnDurationMs".to_string(),
                serde_json::json!(turn_duration_ms),
            );
            let timing = self.transient(ChatMessageType::System, Vec::new(), Some(md));
            self.append_and_display(timing);
        }
    }
}
