use super::*;

impl WorkspacePort for DaemonChatDeps {
    fn remove_scratch_dir<'a>(
        &'a self,
        scratch_path: &'a str,
    ) -> BoxFuture<'a, Result<(), SeamError>> {
        let path = scratch_path.to_string();
        Box::pin(async move {
            match tokio::fs::remove_dir_all(&path).await {
                Ok(()) => Ok(()),
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(err) => Err(SeamError::new(err)),
            }
        })
    }
    fn write_workspace_trust<'a>(
        &'a self,
        project_path: &'a str,
    ) -> BoxFuture<'a, Result<(), SeamError>> {
        Box::pin(async move {
            mainframe_adapter_claude::trust_store::write_workspace_trust(project_path, None)
                .await
                .map_err(SeamError::new)
        })
    }
    fn attachment_delete_chat<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            self.attachments.delete_chat(chat_id).await;
        })
    }
    fn process_attachments<'a>(
        &'a self,
        chat_id: &'a str,
        attachment_ids: &'a [String],
    ) -> BoxFuture<'a, ProcessedAttachments> {
        Box::pin(async move {
            let mut fetched = Vec::with_capacity(attachment_ids.len());
            for id in attachment_ids {
                match self.attachments.get(chat_id, id).await {
                    Some(attachment) => fetched.push(attachment),
                    None => tracing::warn!(
                        chat_id,
                        attachment_id = %id,
                        "processAttachments: attachment not found in store; skipping"
                    ),
                }
            }
            attachment_processor::process_attachments(&fetched)
        })
    }
    fn kill_tasks_for_chat<'a>(
        &'a self,
        chat_id: &'a str,
        worktree_path: Option<String>,
        session: Option<Arc<dyn AdapterSession>>,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let wrapped = session.map(crate::session_kill_bridge::SessionKillBridge);
            let session_ref = wrapped.as_ref().map(|w| w as &dyn SessionLike);
            kill_tasks_for_chat(KillTasksForChatArgs {
                chat_id,
                worktree_path: worktree_path.as_deref(),
                session: session_ref,
                tracker: &self.background_tasks,
                spool_root: None,
            })
            .await;
        })
    }
    fn remove_worktree<'a>(
        &'a self,
        project_path: &'a str,
        worktree_path: &'a str,
        branch_name: &'a str,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            mainframe_services::workspace::remove_worktree(
                project_path,
                worktree_path,
                branch_name,
            )
            .await;
        })
    }
    fn stop_launch_processes<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>> {
        self.launch
            .stop_launch_processes(project_id, effective_path)
    }
    fn stop_scope_tunnels<'a>(
        &'a self,
        project_id: &'a str,
        effective_path: &'a str,
    ) -> Option<BoxFuture<'a, ()>> {
        self.scope_tunnels
            .stop_scope_tunnels(project_id, effective_path)
    }
    fn get_session_context<'a>(
        &'a self,
        chat_id: &'a str,
        project_path: &'a str,
        session: Option<Arc<dyn AdapterSession>>,
        adapter_id: Option<String>,
    ) -> BoxFuture<'a, Result<mainframe_types::context::SessionContext, SeamError>> {
        Box::pin(async move {
            let ctx_db = self.db.clone();
            let lister = AttachmentListerHandle {
                store: Arc::clone(&self.attachments),
            };
            get_session_context(
                chat_id,
                project_path,
                &ctx_db,
                &self.adapters,
                session.as_ref(),
                Some(&lister),
                adapter_id.as_deref(),
            )
            .await
        })
    }
    fn is_working_tree_dirty<'a>(&'a self, project_path: &'a str) -> BoxFuture<'a, bool> {
        Box::pin(async move {
            match self.git.for_project(project_path).status_raw().await {
                Ok(stdout) => !stdout.trim().is_empty(),
                Err(err) => {
                    tracing::warn!(%err, project_path, "git status --porcelain failed");
                    false
                }
            }
        })
    }
    fn extract_mentions_from_text(&self, chat_id: &str, text: &str) -> Result<bool, SeamError> {
        let ctx = self.db.clone();
        extract_mentions_from_text(chat_id, Some(text), &ctx)
    }
}
