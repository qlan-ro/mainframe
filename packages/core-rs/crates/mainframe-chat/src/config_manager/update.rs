use super::*;
type ConfigChanges = (
    Option<RespawnChanges>,
    Option<Arc<dyn AdapterSession>>,
    String,
    bool,
);

impl ChatConfigManager {
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

        let (changes, session, cur_adapter, endpoint_changed) = self.config_changes(
            chat_id,
            &cell,
            RespawnChanges {
                adapter_id,
                model,
                permission_mode,
                plan_mode,
            },
        )?;
        let Some(changes) = changes else {
            return Ok(());
        };
        let session_spawned = session.as_ref().is_some_and(|s| s.is_spawned());
        if session_spawned && changes.adapter_id.is_none() && !endpoint_changed {
            // `session_spawned` implies `Some`; the `if let` avoids an Option unwrap.
            if let Some(session) = session {
                return self
                    .apply_live_session_settings(
                        chat_id,
                        &cell,
                        &session,
                        LiveChanges {
                            model: changes.model,
                            permission_mode: changes.permission_mode,
                            plan_mode: changes.plan_mode,
                        },
                    )
                    .await;
            }
            return Ok(());
        }

        let name = self.shared.deps.adapter_fork_info(&cur_adapter).name;
        let live = self.shared.deps.tracker_list_live(chat_id).len();
        if let Some(refusal) = respawn_refusal(session_spawned, live, &name) {
            return Err(ConfigError::Refused(refusal));
        }
        self.respawn_with_config(chat_id, &cell, changes).await
    }
    fn config_changes(
        &self,
        chat_id: &str,
        cell: &Arc<Mutex<ActiveChat>>,
        changes: RespawnChanges,
    ) -> Result<ConfigChanges, ConfigError> {
        let RespawnChanges {
            adapter_id,
            model,
            permission_mode,
            plan_mode,
        } = changes;
        let (current, session) = {
            let guard = cell.lock_recover();
            (guard.chat.clone(), guard.session.clone())
        };

        self.validate_adapter_change(chat_id, &current, adapter_id.as_deref())?;

        let adapter_changed = adapter_id
            .as_ref()
            .is_some_and(|a| *a != current.adapter_id);
        let model_changed = model_changed(current.model.as_deref(), model.as_deref());
        let mode_changed = permission_mode.is_some_and(|pm| current.permission_mode != Some(pm));
        let plan_mode_changed =
            plan_mode.is_some_and(|pm| pm != current.plan_mode.unwrap_or(false));
        if !adapter_changed && !model_changed && !mode_changed && !plan_mode_changed {
            return Ok((None, session, current.adapter_id, false));
        }

        // The endpoint a model runs against is fixed in the child's environment at
        // spawn, so crossing endpoints needs a respawn even though the adapter is
        // unchanged — `set_model` alone would leave the CLI pointed at the old one.
        let endpoint_changed = model_changed
            && (model.as_deref().and_then(model_endpoint)
                != current.model.as_deref().and_then(model_endpoint)
                || session.as_ref().is_some_and(|session| {
                    model
                        .as_deref()
                        .is_some_and(|model| session.model_requires_restart(model))
                }));

        Ok((
            Some(RespawnChanges {
                adapter_id: if adapter_changed { adapter_id } else { None },
                model: if model_changed { model } else { None },
                permission_mode: if mode_changed { permission_mode } else { None },
                plan_mode: if plan_mode_changed { plan_mode } else { None },
            }),
            session,
            current.adapter_id,
            endpoint_changed,
        ))
    }
    fn validate_adapter_change(
        &self,
        chat_id: &str,
        current: &mainframe_types::chat::Chat,
        adapter_id: Option<&str>,
    ) -> Result<(), ConfigError> {
        if let Some(new_adapter) = adapter_id
            && new_adapter != current.adapter_id
            && (current.vendor_session_id.is_some()
                || self
                    .shared
                    .deps
                    .segment_store()
                    .is_some_and(|s| s.has_native_id(chat_id)))
        {
            return Err(ConfigError::Refused(
                "Use switch-provider to change this chat's provider".to_string(),
            ));
        }

        Ok(())
    }
}
