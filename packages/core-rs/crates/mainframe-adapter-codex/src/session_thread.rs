use super::*;
impl CodexSession {
    pub(super) fn map_permission_mode(&self, mode: ExecutionMode) -> (String, String) {
        permission_mode_policy(mode)
    }
    pub(super) fn map_sandbox_policy(&self, sandbox: &str) -> Value {
        let kind = match sandbox {
            "danger-full-access" => "dangerFullAccess",
            "read-only" => "readOnly",
            _ => "workspaceWrite",
        };
        json!({ "type": kind })
    }
    pub(super) fn thread_params_base(&self, model: Option<&str>) -> Map<String, Value> {
        let mut p = Map::new();
        if let Some(m) = model {
            p.insert("model".into(), json!(m));
        }
        p.insert("cwd".into(), json!(self.project_path));
        p.insert("persistExtendedHistory".into(), json!(true));
        p.insert("persistFullHistory".into(), json!(true));
        p
    }
    pub(super) async fn resolve_target(&self, no_persistence: bool) -> ThreadTarget {
        let override_present = *self
            .transcript_present_override
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        crate::fork::resolve_target(
            self.resume_thread_id.as_deref(),
            self.fork_source.as_ref(),
            no_persistence,
            override_present,
        )
        .await
    }
    pub(super) async fn ensure_thread(
        &self,
        client: &Arc<JsonRpcClient>,
        model: Option<&str>,
        permission_mode: ExecutionMode,
        no_persistence: bool,
    ) -> Result<(), AdapterError> {
        if self
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .thread_id
            .is_some()
        {
            return Ok(());
        }

        let (approval_policy, sandbox) = self.map_permission_mode(permission_mode);
        let base = self.thread_params_base(model);
        let target = self.resolve_target(no_persistence).await;
        let (request, expected_fork_source) = thread_request_for(
            target,
            no_persistence,
            base,
            &approval_policy,
            json!(sandbox),
        );
        let method = request.method();
        let params = request.into_params();
        let res: ThreadStartResult = de(client
            .request(method, Some(Value::Object(params)))
            .await
            .map_err(|e| AdapterError::Message(e.0))?)?;
        self.check_fork_source(&res, expected_fork_source.as_deref());
        let (new_thread_id, reported_model) = (res.thread.id, res.model);

        {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            state.command_state.clear();
            state.thread_id = Some(new_thread_id.clone());
            state.reported_model = non_empty(reported_model.as_deref()).map(str::to_string);
        }
        self.sink
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .on_init(&new_thread_id);
        Ok(())
    }
    fn check_fork_source(&self, res: &ThreadStartResult, expected_fork_source: Option<&str>) {
        if let Some(expected) = expected_fork_source
            && res.thread.forked_from_id.as_deref() != Some(expected)
        {
            tracing::warn!(
                module = "codex:session",
                session_id = %self.id,
                expected,
                actual = ?res.thread.forked_from_id,
                "codex: forked thread's forkedFromId does not match the fork source"
            );
        }
    }
}

pub(super) fn permission_mode_policy(mode: ExecutionMode) -> (String, String) {
    match mode {
        ExecutionMode::Yolo => ("never".to_string(), "danger-full-access".to_string()),
        ExecutionMode::Default => ("on-request".to_string(), "read-only".to_string()),
        ExecutionMode::AcceptEdits => ("on-request".to_string(), "workspace-write".to_string()),
        ExecutionMode::Auto => {
            tracing::warn!(
                "chat is set to the Claude-only `auto` permission mode; Codex runs it as Accept Edits"
            );
            ("on-request".to_string(), "workspace-write".to_string())
        }
    }
}
