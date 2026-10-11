use super::*;

impl ChatConfigManager {
    pub(crate) fn new(
        shared: Arc<crate::chat_manager::ChatShared>,
        lifecycle: Arc<crate::lifecycle_manager::ChatLifecycleManager>,
        worktree_offers: Arc<crate::worktree_offer::WorktreeOfferRegistry>,
    ) -> Self {
        Self {
            shared,
            lifecycle,
            worktree_offers,
            changes: KeyedMutex::default(),
        }
    }

    pub(super) fn active_chat(&self, chat_id: &str) -> Option<Arc<Mutex<ActiveChat>>> {
        let cell = self.shared.active(chat_id)?;
        self.lifecycle.touch(chat_id);
        Some(cell)
    }

    pub(crate) async fn lock_changes(&self, chat_id: &str) -> tokio::sync::OwnedMutexGuard<()> {
        self.changes.acquire(chat_id).await
    }

    pub(super) fn require_active_chat(
        &self,
        chat_id: &str,
    ) -> Result<Arc<Mutex<ActiveChat>>, ConfigError> {
        self.active_chat(chat_id)
            .ok_or_else(|| NotFound::new("Chat", chat_id).into())
    }

    pub(super) async fn detach_session(
        &self,
        cell: &Arc<Mutex<ActiveChat>>,
    ) -> Result<(), ConfigError> {
        let session = cell.lock_recover().session.clone();
        if let Some(session) = session
            && session.is_spawned()
        {
            session.kill().await?;
            cell.lock_recover().session = None;
        }
        Ok(())
    }

    pub(super) async fn apply_live_session_settings(
        &self,
        chat_id: &str,
        cell: &Arc<Mutex<ActiveChat>>,
        session: &Arc<dyn AdapterSession>,
        changes: LiveChanges,
    ) -> Result<(), ConfigError> {
        // An async setter closure in a generic helper is unergonomic, so the
        // three settings are unrolled with identical control flow (try setter →
        // stage into updates/active.chat on Ok, warn on Err).
        let mut updates = ChatPatch::default();

        let model_error = apply_model(chat_id, cell, session, changes.model, &mut updates).await;
        if let Some(mode) = changes.permission_mode {
            match session.set_permission_mode(mode).await {
                Ok(()) => {
                    updates.permission_mode = Some(mode);
                    cell.lock_recover().chat.permission_mode = Some(mode);
                }
                Err(err) => {
                    warn!( error = ?err,
                        chat_id, "setPermissionMode rejected; not persisting permissionMode"
                    )
                }
            }
        }
        if let Some(plan) = changes.plan_mode {
            match session.set_plan_mode(plan).await {
                Ok(()) => {
                    updates.plan_mode = Some(plan);
                    cell.lock_recover().chat.plan_mode = Some(plan);
                }
                Err(err) => warn!( error = ?err,
                    chat_id, "setPlanMode rejected; not persisting planMode"
                ),
            }
        }

        if updates == ChatPatch::default() {
            return model_error.map_or(Ok(()), Err);
        }
        let update = self.shared.prepare_live_update(chat_id, &updates);
        // Model switch can invalidate the live tuning (e.g. xhigh/ultracode on a model that
        // doesn't support them). Re-resolve against the new model and re-apply.
        if updates.model.is_some() {
            crate::chat_manager::shared::apply_tuning_impl(
                &self.shared.active_chats,
                &self.shared.deps,
                chat_id,
            )
            .await;
        }
        let chat = cell.lock_recover().chat.clone();
        update.emit(chat, None);
        model_error.map_or(Ok(()), Err)
    }

    pub(super) async fn respawn_with_config(
        &self,
        chat_id: &str,
        cell: &Arc<Mutex<ActiveChat>>,
        changes: RespawnChanges,
    ) -> Result<(), ConfigError> {
        self.lifecycle.await_starting(chat_id).await;

        let session = cell.lock_recover().session.clone();
        let was_spawned = session.as_ref().is_some_and(|s| s.is_spawned());
        if was_spawned {
            if let Some(session) = &session {
                session.kill().await?;
            }
            cell.lock_recover().session = None;
        }

        let mut updates = ChatPatch::default();
        let mut chat = cell.lock_recover().chat.clone();
        {
            if let Some(adapter_id) = changes.adapter_id {
                updates.adapter_id = Some(adapter_id.clone());
                chat.adapter_id = adapter_id;
            }
            if let Some(model) = changes.model {
                updates.model = Some(model.clone());
                chat.model = Some(model);
            }
            if let Some(mode) = changes.permission_mode {
                updates.permission_mode = Some(mode);
                chat.permission_mode = Some(mode);
            }
            if let Some(plan) = changes.plan_mode {
                updates.plan_mode = Some(plan);
                chat.plan_mode = Some(plan);
            }
        }

        let result = self.shared.prepare_update(chat_id, &updates);
        if result.is_ok() {
            cell.lock_recover().chat = chat.clone();
        }
        let result = result.map(|update| update.emit(chat, None));
        if was_spawned {
            self.lifecycle.start_chat(chat_id).await;
        }
        result.map_err(ConfigError::from)
    }
}

async fn apply_model(
    chat_id: &str,
    cell: &Arc<Mutex<ActiveChat>>,
    session: &Arc<dyn AdapterSession>,
    model: Option<String>,
    updates: &mut ChatPatch,
) -> Option<ConfigError> {
    let mut model_error = None;
    if let Some(model) = model {
        match session.set_model(model.clone()).await {
            Ok(()) => {
                updates.model = Some(model.clone());
                cell.lock_recover().chat.model = Some(model);
            }
            Err(err) => {
                warn!( error = ?err, chat_id, "setModel rejected; not persisting model");
                model_error = Some(ConfigError::Adapter(err));
            }
        }
    }
    model_error
}
