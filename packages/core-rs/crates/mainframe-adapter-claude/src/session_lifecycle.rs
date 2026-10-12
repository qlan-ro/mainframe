use super::*;
impl ClaudeSession {
    pub(crate) fn process_exited(&self, sink: &dyn SessionSink) {
        let mut state = self.state();
        state.presentation.invalidate(sink);
        state.child = None;
        drop(state);
        *self.stdin_tx.lock_recover() = None;
    }
    pub async fn kill(&self) -> Result<(), AdapterError> {
        self.state().presentation.invalidate(&NullSink);
        let child = self.state().child.clone();
        let Some(child) = child else { return Ok(()) };

        child.signal(Signal::Term);
        tokio::select! {
            _ = child.wait_closed() => {}
            _ = tokio::time::sleep(Duration::from_millis(3000)) => {
                if !child.exited() {
                    child.signal(Signal::Kill);
                }
            }
        }
        self.state().child = None;
        self.control.drain_all_as_failed();
        tracing::debug!(session_id = %self.id, "claude session killed");
        Ok(())
    }
    pub async fn interrupt(&self) -> Result<(), AdapterError> {
        self.state().presentation.invalidate(&NullSink);
        let child = self.state().child.clone();
        let Some(child) = child else { return Ok(()) };

        let stdin = self.stdin_clone();
        self.send_control(stdin.as_ref(), &json!({ "subtype": "interrupt" }));
        let task_ids: Vec<String> = { self.state().active_tasks.keys().cloned().collect() };
        for task_id in &task_ids {
            self.send_control(
                stdin.as_ref(),
                &json!({ "subtype": "stop_task", "task_id": task_id }),
            );
        }
        self.state().active_tasks.clear();
        let state = self.state.clone();
        let child_for_timer = child.clone();
        let session_id = self.id.clone();
        let handle = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10_000)).await;
            let mut st = state.lock_recover();
            st.interrupt_timer = None;
            let same = st
                .child
                .as_ref()
                .map(|c| Arc::ptr_eq(&c.exited, &child_for_timer.exited))
                .unwrap_or(false);
            if same && !child_for_timer.exited() {
                tracing::warn!(
                    session_id = %session_id,
                    "protocol interrupt timed out, sending SIGINT fallback"
                );
                child_for_timer.signal(Signal::Int);
            }
        });
        self.state().interrupt_timer = Some(handle);
        Ok(())
    }
    pub(crate) fn clear_interrupt_timer(&self) {
        if let Some(h) = self.state().interrupt_timer.take() {
            h.abort();
        }
    }
    pub(crate) fn request_context_usage(&self) {
        if self.state().child.is_none() {
            return;
        }
        let stdin = self.stdin_clone();
        self.send_control(stdin.as_ref(), &json!({ "subtype": "get_context_usage" }));
    }
    /// Fire-and-forget control request: nothing awaits it, so a write failure
    /// is logged with the request's subtype rather than returned.
    pub(super) fn send_control(&self, stdin: Option<&StdinTx>, request: &serde_json::Value) {
        if let Err(error) = self.control.send(stdin, request) {
            tracing::warn!(
                session_id = %self.id,
                subtype = ?request.get("subtype").and_then(serde_json::Value::as_str),
                %error,
                "control_request not written"
            );
        }
    }
    pub fn get_context_files(&self) -> ContextFiles {
        collect_claude_context_files(&self.project_path, None)
    }
    pub(super) async fn resume_target(&self) -> crate::fork::ResumeTarget {
        let own_transcript_present = match (&self.resume_session_id, &self.fork_source) {
            (Some(id), Some(_)) => {
                crate::transcript::is_claude_transcript_present(
                    id,
                    &self.project_path,
                    self.session_file_path.as_deref(),
                )
                .await
            }
            _ => false,
        };
        crate::fork::resolve_resume(
            self.resume_session_id.as_deref(),
            own_transcript_present,
            self.fork_source.as_ref(),
        )
    }
    pub async fn load_history(&self) -> Result<Vec<ChatMessage>, AdapterError> {
        match self.resume_target().await {
            crate::fork::ResumeTarget::Own(id) => Ok(crate::history::load_history(
                &id,
                &self.project_path,
                self.session_file_path.as_deref(),
            )
            .await),
            crate::fork::ResumeTarget::Fork(path) => {
                let (session_id, dir) = fork_snapshot_lookup(&path, &self.fork_source);
                Ok(crate::history::load_history_in_dir(&session_id, &dir).await)
            }
            crate::fork::ResumeTarget::Fresh => Ok(vec![]),
        }
    }
    /// `load_history`'s own transcript files (main + subagent), resolved the
    /// same way — the history snapshot cache's freshness fingerprint
    /// (`mainframe_chat::history_cache`) is only as correct as this list, so
    /// it must mirror every branch `load_history` takes, not just the common
    /// one.
    pub async fn history_sources(&self) -> Vec<std::path::PathBuf> {
        let discovered = match self.resume_target().await {
            crate::fork::ResumeTarget::Own(id) => {
                crate::history::discover_session_jsonl_files(
                    &id,
                    &self.project_path,
                    self.session_file_path.as_deref(),
                )
                .await
            }
            crate::fork::ResumeTarget::Fork(path) => {
                let (session_id, dir) = fork_snapshot_lookup(&path, &self.fork_source);
                crate::history::discover_session_jsonl_files_in_dir(&session_id, &dir).await
            }
            crate::fork::ResumeTarget::Fresh => return Vec::new(),
        };
        discovered
            .all_files
            .into_iter()
            .map(std::path::PathBuf::from)
            .collect()
    }
    pub async fn extract_plan_files(&self) -> Result<Vec<String>, AdapterError> {
        match self.resume_target().await {
            crate::fork::ResumeTarget::Own(id) => Ok(crate::history::extract_plan_file_paths(
                &id,
                &self.project_path,
                self.session_file_path.as_deref(),
            )
            .await),
            crate::fork::ResumeTarget::Fork(path) => {
                let (session_id, dir) = fork_snapshot_lookup(&path, &self.fork_source);
                Ok(crate::history::extract_plan_file_paths_in_dir(&session_id, &dir).await)
            }
            crate::fork::ResumeTarget::Fresh => Ok(vec![]),
        }
    }
    pub async fn extract_skill_files(&self) -> Result<Vec<SkillFileEntry>, AdapterError> {
        match self.resume_target().await {
            crate::fork::ResumeTarget::Own(id) => Ok(crate::history::extract_skill_file_paths(
                &id,
                &self.project_path,
                self.session_file_path.as_deref(),
            )
            .await),
            crate::fork::ResumeTarget::Fork(path) => {
                let (session_id, dir) = fork_snapshot_lookup(&path, &self.fork_source);
                Ok(crate::history::extract_skill_file_paths_in_dir(
                    &session_id,
                    &dir,
                    &self.project_path,
                )
                .await)
            }
            crate::fork::ResumeTarget::Fresh => Ok(vec![]),
        }
    }
}

pub(super) fn fork_snapshot_lookup(
    path: &str,
    fork_source: &Option<mainframe_types::adapter::ForkSource>,
) -> (String, String) {
    let session_id = fork_source
        .as_ref()
        .map(|f| f.source_session_id.clone())
        .unwrap_or_default();
    let dir = std::path::Path::new(path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    (session_id, dir)
}
