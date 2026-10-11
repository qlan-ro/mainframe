use super::*;

impl<D: ConfigManagerDeps> ChatConfigManager<D> {
    pub async fn update_chat_config(
        &self,
        chat_id: &str,
        adapter_id: Option<String>,
        model: Option<String>,
        permission_mode: Option<ExecutionMode>,
        plan_mode: Option<bool>,
    ) -> Result<(), ConfigError> {
        let _change = self.changes.acquire(chat_id).await;
        let cell = self.require_active_chat(chat_id)?;

        let (cur_adapter, cur_model, cur_mode, cur_plan, has_claude_session, session) = {
            let guard = cell.lock_recover();
            (
                guard.chat.adapter_id.clone(),
                guard.chat.model.clone(),
                guard.chat.permission_mode,
                guard.chat.plan_mode,
                guard.chat.claude_session_id.is_some(),
                guard.session.clone(),
            )
        };

        if let Some(ref new_adapter) = adapter_id
            && *new_adapter != cur_adapter
            && (has_claude_session || self.deps.has_native_session(chat_id))
        {
            return Err(ConfigError::Refused(
                "Use switch-provider to change this chat's provider".to_string(),
            ));
        }

        let adapter_changed = adapter_id.as_ref().is_some_and(|a| *a != cur_adapter);
        let model_changed = model_changed(cur_model.as_deref(), model.as_deref());
        let mode_changed = match permission_mode {
            Some(pm) => cur_mode != Some(pm),
            None => false,
        };
        let plan_mode_changed = match plan_mode {
            Some(pm) => pm != cur_plan.unwrap_or(false),
            None => false,
        };
        if !adapter_changed && !model_changed && !mode_changed && !plan_mode_changed {
            return Ok(());
        }

        // The endpoint a model runs against is fixed in the child's environment at
        // spawn, so crossing endpoints needs a respawn even though the adapter is
        // unchanged — `set_model` alone would leave the CLI pointed at the old one.
        let endpoint_changed = model_changed
            && (model.as_deref().and_then(model_endpoint)
                != cur_model.as_deref().and_then(model_endpoint)
                || session.as_ref().is_some_and(|session| {
                    model
                        .as_deref()
                        .is_some_and(|model| session.model_requires_restart(model))
                }));

        let session_spawned = session.as_ref().is_some_and(|s| s.is_spawned());
        if session_spawned && !adapter_changed && !endpoint_changed {
            // `session_spawned` implies `Some`; the `if let` avoids an Option unwrap.
            if let Some(session) = session {
                return self
                    .apply_live_session_settings(
                        chat_id,
                        &cell,
                        &session,
                        LiveChanges {
                            model: if model_changed { model } else { None },
                            permission_mode: if mode_changed { permission_mode } else { None },
                            plan_mode: if plan_mode_changed { plan_mode } else { None },
                        },
                    )
                    .await;
            }
            return Ok(());
        }

        let name = self.deps.adapter_name(&cur_adapter);
        let live = self.deps.live_background_tasks(chat_id);
        if let Some(refusal) = respawn_refusal(session_spawned, live, &name) {
            return Err(ConfigError::Refused(refusal));
        }
        self.respawn_with_config(
            chat_id,
            &cell,
            RespawnChanges {
                adapter_id: if adapter_changed { adapter_id } else { None },
                model: if model_changed { model } else { None },
                permission_mode: if mode_changed { permission_mode } else { None },
                plan_mode: if plan_mode_changed { plan_mode } else { None },
            },
        )
        .await
    }
}
