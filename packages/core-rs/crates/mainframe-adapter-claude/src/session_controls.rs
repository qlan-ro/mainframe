use super::*;
impl ClaudeSession {
    pub async fn set_permission_mode(&self, mode: ExecutionMode) -> Result<(), AdapterError> {
        if !self.is_spawned() {
            return Err(AdapterError::Message(format!(
                "Session {} not spawned",
                self.id
            )));
        }
        let cli_mode = execution_mode_cli(mode).to_string();
        *self
            .base_permission_mode
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = cli_mode.clone();
        self.write_cli_permission_mode(&cli_mode);
        Ok(())
    }
    pub async fn set_plan_mode(&self, on: bool) -> Result<(), AdapterError> {
        if !self.is_spawned() {
            return Err(AdapterError::Message(format!(
                "Session {} not spawned",
                self.id
            )));
        }
        let mode = if on {
            "plan".to_string()
        } else {
            self.base_permission_mode
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone()
        };
        self.write_cli_permission_mode(&mode);
        Ok(())
    }
    pub(super) fn write_cli_permission_mode(&self, cli_mode: &str) {
        let stdin = self.stdin_clone();
        self.control.send(
            stdin.as_ref(),
            &json!({ "subtype": "set_permission_mode", "mode": cli_mode }),
        );
    }
    pub(super) async fn await_terminal(&self, request: Value, label: &str) -> Option<Value> {
        let stdin = self.stdin_clone();
        self.control
            .send_awaiting(
                stdin.as_ref(),
                &request,
                SendAwaitingOpts {
                    label: label.to_string(),
                    timeout_ms: None,
                    is_terminal: Some(Box::new(is_terminal_ctrl)),
                },
            )
            .await
    }
    pub(super) async fn require_success(
        &self,
        request: Value,
        subtype: &str,
    ) -> Result<(), AdapterError> {
        let raw = self.await_terminal(request, subtype).await;
        if raw
            .as_ref()
            .and_then(|v| v.get("subtype"))
            .and_then(Value::as_str)
            == Some("success")
        {
            return Ok(());
        }
        let err = raw
            .as_ref()
            .and_then(|v| v.get("error"))
            .and_then(Value::as_str)
            .unwrap_or("timeout");
        Err(AdapterError::Message(format!("{subtype} failed: {err}")))
    }
    pub async fn set_model(&self, model: String) -> Result<(), AdapterError> {
        if !self.is_spawned() {
            return Err(AdapterError::Message(format!(
                "Session {} not spawned",
                self.id
            )));
        }
        let model = if model == "default" {
            let executable = self
                .executable
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            crate::effective_model::required_probe(
                &executable,
                self.resolved_path.as_str(),
                &self.project_path,
            )
            .await?
        } else {
            model
        };
        let (_, bare) = cliproxy::split_endpoint(&model);
        self.require_success(
            json!({ "subtype": "set_model", "model": bare }),
            "set_model",
        )
        .await
    }
    pub async fn apply_tuning(&self, tuning: ResolvedTuning) -> Result<(), AdapterError> {
        if !self.is_spawned() {
            return Err(AdapterError::Message(format!(
                "Session {} not spawned",
                self.id
            )));
        }
        self.require_success(
            json!({ "subtype": "apply_flag_settings", "settings": tuning_to_flag_settings(&tuning) }),
            "apply_flag_settings",
        )
        .await
    }
}

pub(super) fn is_terminal_ctrl(raw: &Option<Value>) -> bool {
    raw.as_ref()
        .and_then(|v| v.get("subtype"))
        .and_then(Value::as_str)
        .map(|s| s == "success" || s == "error")
        .unwrap_or(false)
}

pub(super) fn has_cancelled_flag(raw: &Option<Value>) -> bool {
    raw.as_ref()
        .and_then(|v| v.get("response"))
        .and_then(|r| r.get("cancelled"))
        .map(Value::is_boolean)
        .unwrap_or(false)
}

pub(super) fn execution_mode_cli(mode: ExecutionMode) -> &'static str {
    match mode {
        ExecutionMode::Default => "default",
        ExecutionMode::AcceptEdits => "acceptEdits",
        ExecutionMode::Auto => "auto",
        ExecutionMode::Yolo => "bypassPermissions",
    }
}
