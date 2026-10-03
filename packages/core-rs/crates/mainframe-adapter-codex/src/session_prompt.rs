use super::*;
impl CodexSession {
    pub(super) async fn send_message_inner(
        &self,
        message: String,
        images: Vec<ImageInput>,
        _uuid: Option<String>,
    ) -> Result<(), AdapterError> {
        let client = self
            .client
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let Some(client) = client else {
            return Err(AdapterError::Message(format!(
                "Session {} not spawned",
                self.id
            )));
        };

        let crate::user_input::TurnInput {
            input,
            undeliverable,
        } = crate::user_input::build_turn_input(&message, &images);
        let input =
            serde_json::to_value(&input).map_err(|e| AdapterError::Message(e.to_string()))?;

        let cfg = self
            .config
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let model = self.model_for_turn(cfg.model.clone()).await?;
        self.ensure_thread(
            &client,
            model.as_deref(),
            cfg.permission_mode,
            cfg.no_persistence,
        )
        .await?;

        let (thread_id, resolved_model) = self.resolve_prompt_model(model.as_deref())?;
        let p = self.prompt_params(input, model.as_deref(), &cfg, &thread_id, &resolved_model)?;
        let _: TurnStartResult = de(client
            .request("turn/start", Some(Value::Object(p)))
            .await
            .map_err(|e| AdapterError::Message(e.0))?)?;

        self.report_undeliverable(&undeliverable);
        *self.status.lock().unwrap_or_else(|e| e.into_inner()) = AdapterProcessStatus::Running;
        Ok(())
    }

    fn resolve_prompt_model(&self, model: Option<&str>) -> Result<(String, String), AdapterError> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let resolved_model = resolve_turn_model(model, state.reported_model.as_deref())
            .inspect_err(|err| {
                tracing::error!(
                    module = "codex:session",
                    session_id = %self.id,
                    err = %err,
                    "codex: cannot start turn without a model"
                );
            })?;
        state.resolved_turn_model = Some(resolved_model.clone());
        Ok((state.thread_id.clone().unwrap_or_default(), resolved_model))
    }

    fn prompt_params(
        &self,
        input: Value,
        model: Option<&str>,
        cfg: &PendingConfig,
        thread_id: &str,
        resolved_model: &str,
    ) -> Result<Map<String, Value>, AdapterError> {
        let (approval_policy, sandbox) = self.map_permission_mode(cfg.permission_mode);
        let default_resolved = ResolvedTuning {
            effort: None,
            fast: false,
            ultracode: false,
            adaptive_thinking: false,
        };
        let turn_cfg = build_turn_config(
            cfg.tuning.as_ref().unwrap_or(&default_resolved),
            &cfg.codex_provider_tuning,
            resolved_model,
            if cfg.plan_mode { "plan" } else { "default" },
        );

        let mut p = Map::new();
        p.insert("threadId".into(), json!(thread_id));
        p.insert("input".into(), input);
        p.insert("approvalPolicy".into(), json!(approval_policy));
        p.insert("sandboxPolicy".into(), self.map_sandbox_policy(&sandbox));
        p.insert(
            "collaborationMode".into(),
            serde_json::to_value(&turn_cfg.collaboration_mode)
                .map_err(|e| AdapterError::Message(e.to_string()))?,
        );
        if let Some(m) = model {
            p.insert("model".into(), json!(m));
        }
        if let Some(st) = &turn_cfg.service_tier {
            p.insert("serviceTier".into(), json!(st));
        }
        if let Some(pers) = &turn_cfg.personality {
            p.insert("personality".into(), json!(pers));
        }
        if let Some(sum) = &turn_cfg.summary {
            p.insert("summary".into(), json!(sum));
        }
        Ok(p)
    }

    fn report_undeliverable(&self, undeliverable: &[crate::user_input::UndeliverableReason]) {
        if let Some(notice) = crate::user_input::undeliverable_notice(undeliverable) {
            tracing::warn!(
                module = "codex:session",
                session_id = %self.id,
                count = undeliverable.len(),
                "codex: images not delivered"
            );
            self.sink
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone()
                .on_cli_message(&notice);
        }
    }
}
