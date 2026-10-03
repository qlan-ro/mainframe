use super::*;
impl CodexSession {
    pub(super) async fn kill_inner(&self) -> Result<(), AdapterError> {
        let sink = self.sink.lock().unwrap_or_else(|e| e.into_inner()).clone();
        clear_after_exit(&self.state, &*sink);
        let client = self
            .client
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let Some(client) = client else {
            return Ok(());
        };
        if let Some(approval) = self
            .approval_handler
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            approval.reject_all();
        }
        client.close();
        let _ = tokio::time::timeout(Duration::from_millis(3000), client.closed()).await;
        *self.client.lock().unwrap_or_else(|e| e.into_inner()) = None;
        Ok(())
    }
    pub(super) async fn interrupt_inner(&self) -> Result<(), AdapterError> {
        let client = self
            .client
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let (thread_id, turn_id) = {
            let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
            st.command_state.clear();
            (st.thread_id.clone(), st.current_turn_id.clone())
        };
        let (Some(client), Some(thread_id), Some(turn_id)) = (client, thread_id, turn_id) else {
            return Ok(());
        };
        client
            .request(
                "turn/interrupt",
                Some(json!({ "threadId": thread_id, "turnId": turn_id })),
            )
            .await
            .map_err(|e| AdapterError::Message(e.0))?;
        Ok(())
    }
    pub(super) fn build_handlers(&self, approval: Arc<ApprovalHandler>) -> JsonRpcHandlers {
        let sink_n = self.sink.clone();
        let state_n = self.state.clone();
        let state_x = self.state.clone();
        let sink_e = self.sink.clone();
        let status_x = self.status.clone();
        let client_slot_x = self.client.clone();
        let sink_x = self.sink.clone();
        let on_exit_cb = self.on_exit_callback.clone();

        JsonRpcHandlers {
            on_notification: Box::new(move |method, params| {
                let s = sink_n.lock().unwrap_or_else(|e| e.into_inner()).clone();
                handle_notification(
                    &method,
                    &params,
                    &s,
                    &mut state_n.lock().unwrap_or_else(|e| e.into_inner()),
                );
            }),
            on_request: self.request_handler(approval),
            on_error: Box::new(move |error| {
                let s = sink_e.lock().unwrap_or_else(|e| e.into_inner()).clone();
                s.on_error(AdapterError::Message(error));
            }),
            on_exit: Box::new(move |code| {
                let s = sink_x.lock().unwrap_or_else(|e| e.into_inner()).clone();
                clear_after_exit(&state_x, &*s);
                *status_x.lock().unwrap_or_else(|e| e.into_inner()) = AdapterProcessStatus::Stopped;
                *client_slot_x.lock().unwrap_or_else(|e| e.into_inner()) = None;
                s.on_exit(code);
                if let Some(cb) = on_exit_cb.lock().unwrap_or_else(|e| e.into_inner()).take() {
                    cb();
                }
            }),
        }
    }
    fn request_handler(
        &self,
        approval: Arc<ApprovalHandler>,
    ) -> Box<dyn Fn(String, Value, crate::types::RequestId) + Send + Sync> {
        let state_r = self.state.clone();
        let config_r = self.config.clone();
        let client_slot_r = self.client.clone();
        let approval_r = approval;
        Box::new(move |method, params, id| {
            let plan_mode = config_r.lock().unwrap_or_else(|e| e.into_inner()).plan_mode;
            let current_turn_plan = state_r
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .current_turn_plan
                .clone();
            approval_r.set_plan_context(PlanContext {
                plan_mode,
                current_turn_plan,
            });
            let cs = client_slot_r.clone();
            approval_r.handle_request(
                &method,
                &params,
                id,
                Box::new(move |rpc_id, result| {
                    if let Some(c) = cs.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
                        c.respond(rpc_id, result);
                    }
                }),
            );
        })
    }
}

pub(super) fn clear_after_exit(state: &Mutex<CodexSessionState>, sink: &dyn SessionSink) {
    let mut state = state.lock().unwrap_or_else(|e| e.into_inner());
    state.presentation.invalidate_unfinished(sink);
    state.clear_transient();
}

pub(super) struct NullSink;
impl SessionSink for NullSink {
    fn on_init(&self, _session_id: &str) {}
    fn on_message(
        &self,
        _content: Vec<mainframe_types::chat::MessageContent>,
        _metadata: Option<mainframe_types::adapter::MessageMetadata>,
    ) {
    }
    fn on_tool_result(
        &self,
        _content: Vec<mainframe_types::chat::MessageContent>,
        _vendor_id: Option<String>,
    ) {
    }
    fn on_permission(&self, _request: mainframe_adapter_api::ControlRequest) {}
    fn on_result(&self, _data: mainframe_types::adapter::SessionResult) {}
    fn on_exit(&self, _code: Option<i32>) {}
    fn on_error(&self, _error: AdapterError) {}
    fn on_compact(&self, _vendor_id: Option<&str>) {}
    fn on_compact_start(&self) {}
    fn on_context_usage(&self, _usage: mainframe_types::adapter::ContextUsage) {}
    fn on_plan_file(&self, _file_path: &str) {}
    fn on_skill_file(&self, _entry: SkillFileEntry) {}
    fn on_queued_processed(&self, _uuid: &str) {}
    fn on_todo_update(&self, _todos: Vec<mainframe_types::chat::TodoItem>) {}
    fn on_pr_detected(&self, _pr: mainframe_types::adapter::DetectedPr) {}
    fn on_cli_message(&self, _text: &str) {}
    fn on_skill_loaded(&self, _entry: mainframe_adapter_api::LoadedSkill) {}
    fn on_subagent_child(
        &self,
        _parent_tool_use_id: &str,
        _blocks: Vec<mainframe_types::chat::MessageContent>,
    ) {
    }
}

pub(super) fn null_sink() -> Arc<dyn SessionSink> {
    Arc::new(NullSink)
}
