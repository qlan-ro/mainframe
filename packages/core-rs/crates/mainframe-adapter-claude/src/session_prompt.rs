use super::*;
impl ClaudeSession {
    pub(super) fn write_stdin(&self, line: String) {
        if let Some(tx) = self.stdin_clone() {
            let mut bytes = line.into_bytes();
            bytes.push(b'\n');
            let _ = tx.send(bytes);
        }
        self.bump_last_activity();
    }
    pub async fn send_command(&self, command: String, args: String) -> Result<(), AdapterError> {
        if !self.is_spawned() {
            return Err(AdapterError::Message(format!(
                "Session {} not spawned",
                self.id
            )));
        }
        let chat_id = self.state().chat_id.clone();
        let text = format!(
            "<command-name>/{command}</command-name>\n<command-message>{command}</command-message>\n<command-args>{args}</command-args>"
        );
        let payload = json!({
            "type": "user",
            "session_id": chat_id,
            "message": { "role": "user", "content": [{ "type": "text", "text": text }] },
            "parent_tool_use_id": null,
        });
        self.write_stdin(payload.to_string());
        Ok(())
    }
    pub async fn send_message(
        &self,
        message: String,
        images: Vec<ImageInput>,
        uuid: Option<String>,
    ) -> Result<(), AdapterError> {
        if !self.is_spawned() {
            return Err(AdapterError::Message(format!(
                "Session {} not spawned",
                self.id
            )));
        }
        let chat_id = self.state().chat_id.clone();
        let payload =
            crate::user_payload::build_user_payload(&chat_id, &message, &images, uuid.as_deref());
        self.write_stdin(payload.to_string());
        Ok(())
    }
    pub async fn respond_to_permission(
        &self,
        response: ControlResponse,
    ) -> Result<(), AdapterError> {
        let behavior_str = if response.behavior == ControlBehavior::Allow {
            "allow"
        } else {
            "deny"
        };
        let inner = permission_inner(&response, behavior_str);
        let payload = json!({
            "type": "control_response",
            "response": {
                "subtype": "success",
                "request_id": response.request_id,
                "response": inner,
            },
        });
        let json_str = payload.to_string();

        let Some(tx) = self.available_stdin() else {
            tracing::error!(
                session_id = %self.id,
                request_id = %response.request_id,
                tool_name = ?response.tool_name,
                "respondToPermission: stdin unavailable, response dropped"
            );
            return Ok(());
        };
        tracing::info!(
            session_id = %self.id,
            request_id = %response.request_id,
            tool_name = ?response.tool_name,
            behavior = %behavior_str,
            payload = %json_str,
            "writing permission response to stdin"
        );
        let mut bytes = json_str.into_bytes();
        bytes.push(b'\n');
        let _ = tx.send(bytes);
        Ok(())
    }
    pub async fn cancel_queued_message(&self, uuid: String) -> Result<bool, AdapterError> {
        let Some(tx) = self.available_stdin() else {
            tracing::warn!(session_id = %self.id, uuid = %uuid, "cancelQueuedMessage: stdin unavailable");
            return Ok(false);
        };
        let raw = self
            .control
            .send_awaiting(
                Some(&tx),
                &json!({ "subtype": "cancel_async_message", "message_uuid": uuid }),
                SendAwaitingOpts {
                    label: "cancel_async_message".to_string(),
                    timeout_ms: None,
                    is_terminal: Some(Box::new(has_cancelled_flag)),
                },
            )
            .await;
        Ok(raw
            .as_ref()
            .and_then(|v| v.get("response"))
            .and_then(|r| r.get("cancelled"))
            .and_then(Value::as_bool)
            .unwrap_or(false))
    }
    pub async fn stop_background_task(
        &self,
        task_id: String,
    ) -> Result<StopBackgroundTaskResult, AdapterError> {
        let Some(tx) = self.available_stdin() else {
            tracing::warn!(session_id = %self.id, task_id = %task_id, "stopBackgroundTask: stdin unavailable");
            return Ok(StopBackgroundTaskResult {
                ok: false,
                error: Some("stdin unavailable".to_string()),
            });
        };
        let raw = self
            .control
            .send_awaiting(
                Some(&tx),
                &json!({ "subtype": "stop_task", "task_id": task_id }),
                SendAwaitingOpts {
                    label: "stop_task".to_string(),
                    timeout_ms: None,
                    is_terminal: Some(Box::new(is_terminal_ctrl)),
                },
            )
            .await;
        if raw
            .as_ref()
            .and_then(|v| v.get("subtype"))
            .and_then(Value::as_str)
            == Some("success")
        {
            return Ok(StopBackgroundTaskResult {
                ok: true,
                error: None,
            });
        }
        let err = raw
            .as_ref()
            .and_then(|v| v.get("error"))
            .or_else(|| {
                raw.as_ref()
                    .and_then(|v| v.get("response"))
                    .and_then(|r| r.get("error"))
            })
            .and_then(Value::as_str)
            .unwrap_or("timeout")
            .to_string();
        Ok(StopBackgroundTaskResult {
            ok: false,
            error: Some(err),
        })
    }
}

fn permission_inner(response: &ControlResponse, behavior_str: &str) -> Value {
    let mut inner = json!({
        "behavior": behavior_str,
        "toolUseID": response.tool_use_id,
    });

    let tool_name = response.tool_name.as_deref();
    if response.behavior == ControlBehavior::Allow {
        if let Some(ui) = &response.updated_input {
            inner["updatedInput"] = serde_json::to_value(ui).unwrap_or(Value::Null);
        }
        if let Some(up) = response.updated_permissions.clone() {
            inner["updatedPermissions"] = serde_json::to_value(
                crate::permission_updates::keep_mode_changes_session_scoped(up),
            )
            .unwrap_or(Value::Null);
        }
    } else {
        inner["message"] = Value::String(denial_message(response));
        if tool_name != Some("AskUserQuestion") && tool_name != Some("ExitPlanMode") {
            inner["interrupt"] = Value::Bool(true);
        }
    }

    inner
}

fn denial_message(response: &ControlResponse) -> String {
    let tool_name = response.tool_name.as_deref();
    if tool_name == Some("ExitPlanMode") {
        let preamble = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file).";
        match &response.message {
            Some(m) => {
                format!("{preamble} To tell you how to proceed, the user said:\n{m}")
            }
            None => format!(
                "{preamble} The user rejected the plan. Stay in plan mode and wait for new instructions from the user."
            ),
        }
    } else {
        response.message.clone().unwrap_or_else(|| {
            if tool_name == Some("AskUserQuestion") {
                "User skipped the question".to_string()
            } else {
                "User denied permission".to_string()
            }
        })
    }
}
