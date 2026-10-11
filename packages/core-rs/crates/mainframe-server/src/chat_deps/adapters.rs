use super::*;

impl AdapterPort for DaemonChatDeps {
    fn get_tool_categories(&self, chat_id: &str) -> Option<ToolCategories> {
        let id = chat_id.to_string();
        let chat = self
            .db
            .call_blocking(move |d| d.chats.get(&id))
            .ok()
            .flatten()?;
        let layout = mainframe_chat::segments::SegmentStore::layout(self, chat_id);
        let adapters = segment_adapters(&chat.adapter_id, layout.as_ref());
        union_categories(adapters.iter().filter_map(|adapter_id| {
            self.adapters
                .get(adapter_id)
                .and_then(|a| a.get_tool_categories())
        }))
    }
    fn prepare_messages_for_client(
        &self,
        raw: &[ChatMessage],
        categories: Option<&ToolCategories>,
    ) -> Vec<DisplayMessage> {
        prepare_messages_for_client(raw, categories)
    }

    fn display_projector(&self) -> Box<dyn mainframe_display::DisplayProjector> {
        Box::new(mainframe_adapter_claude::messages::incremental::IncrementalProjector::new())
    }
    fn strip_command_tags(&self, text: &str) -> String {
        strip_mainframe_command_tags(text)
    }
    fn initial_transcript_path(
        &self,
        adapter_id: &str,
        session_id: &str,
        cwd: &str,
    ) -> Option<String> {
        self.adapters
            .get(adapter_id)?
            .initial_transcript_path(session_id, cwd)
    }
    fn create_session(
        &self,
        adapter_id: &str,
        options: SessionOptions,
    ) -> Option<Arc<dyn AdapterSession>> {
        self.adapters
            .get(adapter_id)
            .map(|adapter| adapter.create_session(options))
    }
    fn create_plan_mode_handler(&self, adapter_id: &str) -> Option<Arc<dyn PlanModeActionHandler>> {
        self.adapters
            .get(adapter_id)
            .and_then(|adapter| adapter.create_plan_mode_handler())
    }
    fn scan_loaded_history<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let Some(session) = self.session_for_scan(chat_id) else {
                return;
            };
            // Mentions and PRs read different histories: `load_history` is the
            // adapter's canonical transcript (what the user actually typed),
            // while `load_scan_records` may reconstruct extra tool-output-only
            // records `load_history` never returns (Codex's rollout — see
            // `scan_and_persist_mentions`). Each scan gets its own source; a
            // failure on one must not skip the other.
            match session.load_history().await {
                Ok(history) if !history.is_empty() => {
                    self.scan_and_persist_mentions(chat_id, &history);
                }
                Ok(_) => {}
                Err(err) => tracing::warn!(%err, chat_id, "load_history failed"),
            }
            match session.load_scan_records().await {
                Ok(history) if !history.is_empty() => {
                    self.scan_and_persist_prs(chat_id, &history);
                }
                Ok(_) => {}
                Err(err) => tracing::warn!(%err, chat_id, "load_scan_records failed"),
            }
            self.persist_plan_and_skill_files(chat_id, session.as_ref())
                .await;
        })
    }
    fn resolve_tuning<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Option<ResolvedTuning>> {
        Box::pin(async move {
            let chat = self.chats_get(chat_id)?;
            let models = match self.adapters.get(&chat.adapter_id) {
                Some(adapter) => adapter.list_models().await.unwrap_or_default(),
                None => Vec::new(),
            };
            Some(resolve_tuning_for_chat(&chat, &self.db, &models).await)
        })
    }
    fn apply_codex_provider_tuning(&self, _session: &Arc<dyn AdapterSession>) {
        // TODO: `set_codex_provider_tuning` (personality, reasoning summary) is a
        // Codex-only session method that the generic `AdapterSession` trait does not
        // expose, so this cannot reach it and the tuning stays at its default.
        // The no-op is correct for every non-Codex adapter.
    }
    fn generate_title<'a>(
        &'a self,
        adapter_id: &'a str,
        content: &'a str,
        binary: &'a str,
    ) -> BoxFuture<'a, Option<String>> {
        // Route to the owning adapter's `generate_title`; an unregistered
        // adapter id and an adapter error are logged separately so an operator
        // can tell the two apart.
        let Some(adapter) = self.adapters.get(adapter_id) else {
            tracing::warn!(
                adapter_id,
                reason = "unknown_adapter",
                "title generation skipped"
            );
            return Box::pin(async { None });
        };
        let content = content.to_string();
        let binary = binary.to_string();
        let adapter_id = adapter_id.to_string();
        Box::pin(async move {
            match adapter.generate_title(content, binary).await {
                Ok(title) => title,
                Err(err) => {
                    tracing::warn!(%err, adapter_id, reason = "adapter_error", "title generation failed");
                    None
                }
            }
        })
    }
    fn locate_transcript<'a>(
        &'a self,
        adapter_id: &'a str,
        session_id: &'a str,
        project_path: &'a str,
        session_file_path: Option<&'a str>,
    ) -> BoxFuture<'a, Option<mainframe_types::transcript::TranscriptLocation>> {
        let adapter = self.adapters.get(adapter_id);
        let (session_id, project_path) = (session_id.to_string(), project_path.to_string());
        let session_file_path = session_file_path.map(str::to_string);
        Box::pin(async move {
            let Some(adapter) = adapter else {
                tracing::warn!(adapter_id, "transcript presence: no adapter registered");
                return None;
            };
            match adapter
                .locate_transcript(session_id, project_path, session_file_path)
                .await
            {
                Ok(location) => location,
                Err(err) => {
                    tracing::warn!(%err, adapter_id, "transcript lookup failed");
                    None
                }
            }
        })
    }
    fn adapter_supports_no_persistence(&self, adapter_id: &str) -> bool {
        self.adapters
            .get(adapter_id)
            .is_some_and(|adapter| adapter.capabilities().no_persistence)
    }
    fn on_provider_quota(&self, adapter_id: &str, quota: ProviderQuota) {
        // Session-pushed quota sparse-merges (Push): a partial blob keeps prior
        // windows. `ingest` persists + fans out `provider.quota.updated` itself.
        self.quota.ingest(adapter_id, quota, IngestMode::Push);
    }
    fn adapter_fork_info(&self, adapter_id: &str) -> AdapterForkInfo {
        match self.adapters.get(adapter_id) {
            Some(adapter) => AdapterForkInfo {
                name: adapter.name().to_string(),
                fork: adapter.capabilities().fork,
                unavailable_reason: adapter.fork_unavailable_reason(),
            },
            None => AdapterForkInfo {
                name: adapter_id.to_string(),
                fork: false,
                unavailable_reason: None,
            },
        }
    }
    fn pin_fork_point<'a>(
        &'a self,
        adapter_id: &'a str,
        request: ForkPinRequest,
    ) -> BoxFuture<'a, Result<mainframe_types::adapter::ForkSource, ForkPinError>> {
        let adapter = self.adapters.get(adapter_id);
        Box::pin(async move {
            let Some(adapter) = adapter else {
                return Err(ForkPinError::Unsupported);
            };
            adapter.pin_fork_point(request).await
        })
    }
    fn adapter_info(&self, adapter_id: &str) -> Option<mainframe_types::adapter::AdapterInfo> {
        self.adapters
            .get_snapshots()
            .into_iter()
            .find(|info| info.id == adapter_id)
    }
}
