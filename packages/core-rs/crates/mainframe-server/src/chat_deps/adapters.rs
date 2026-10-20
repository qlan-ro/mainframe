use super::*;

impl AdapterPort for DaemonChatDeps {
    fn get_tool_categories(&self, chat_id: &str) -> Option<ToolCategories> {
        let chat = match self.chats_get(chat_id) {
            Ok(chat) => chat?,
            Err(error) => {
                self.emit_storage_error(chat_id, error);
                return None;
            }
        };
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
        chat_id: &str,
        raw: &[ChatMessage],
        categories: Option<&ToolCategories>,
    ) -> Vec<DisplayMessage> {
        mainframe_display::display_pipeline::prepare_messages_with_decoders(
            raw,
            categories,
            self.display_decoders(chat_id).as_ref(),
        )
    }

    fn display_projector(&self, chat_id: &str) -> Box<dyn mainframe_display::DisplayProjector> {
        Box::new(
            mainframe_display::incremental::IncrementalProjector::with_decoders(
                self.display_decoders(chat_id),
            ),
        )
    }
    fn strip_command_tags(&self, text: &str) -> String {
        mainframe_display::ToolResultDecoders::strip_command_tags(
            &mainframe_display::decoders::MainframeDecoders,
            text,
        )
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
    fn scan_loaded_history<'a>(
        &'a self,
        chat_id: &'a str,
        canonical: Option<&'a [ChatMessage]>,
    ) -> BoxFuture<'a, ()> {
        Box::pin(self.scan_history(chat_id, canonical))
    }
    fn resolve_tuning<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Option<ResolvedTuning>> {
        Box::pin(async move {
            let chat = match self.chats_get(chat_id) {
                Ok(chat) => chat?,
                Err(error) => {
                    self.emit_storage_error(chat_id, error);
                    return None;
                }
            };
            let models = match self.adapters.get(&chat.adapter_id) {
                Some(adapter) => {
                    let catalog = adapter.catalog();
                    if catalog.is_empty() {
                        match adapter.refresh_catalog(None).await {
                            Ok(models) => models.unwrap_or_default(),
                            Err(error) => {
                                tracing::warn!(%error, "tuning catalog refresh failed");
                                Vec::new()
                            }
                        }
                    } else {
                        catalog
                    }
                }
                None => Vec::new(),
            };
            Some(resolve_tuning_for_chat(&chat, &self.db, &models).await)
        })
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
                    tracing::warn!(error = %err, adapter_id, reason = "adapter_error", "title generation failed");
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
                tracing::warn!(adapter_id, "no adapter registered");
                return None;
            };
            match adapter
                .locate_transcript(session_id, project_path, session_file_path)
                .await
            {
                Ok(location) => location,
                Err(err) => {
                    tracing::warn!(error = %err, adapter_id, "transcript lookup failed");
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
        // Folds in with the adapter's registered push mode: Claude sparse-merges,
        // Codex replaces. `ingest` persists + fans out `provider.quota.updated` itself.
        self.quota.ingest_push(adapter_id, quota);
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

impl DaemonChatDeps {
    fn display_decoders(&self, chat_id: &str) -> Arc<dyn mainframe_display::ToolResultDecoders> {
        let layout = mainframe_chat::segments::SegmentStore::layout(self, chat_id);
        let initial = layout
            .as_ref()
            .and_then(|layout| {
                layout
                    .segments
                    .first()
                    .and_then(|s| layout.native(&s.native_session_ref))
            })
            .map(|native| native.adapter_id.clone())
            .or_else(|| match self.chats_get(chat_id) {
                Ok(chat) => chat.map(|chat| chat.adapter_id),
                Err(error) => {
                    self.emit_storage_error(chat_id, error);
                    None
                }
            })
            .unwrap_or_default();
        decoder_set(&self.adapters, initial)
    }
}

pub(super) fn decoder_set(
    adapters: &AdapterRegistry,
    initial: String,
) -> Arc<dyn mainframe_display::ToolResultDecoders> {
    Arc::new(mainframe_display::decoders::DecoderSet::new(
        initial,
        adapters
            .get_all()
            .iter()
            .map(|adapter| (adapter.id().to_string(), adapter.display_decoders()))
            .collect(),
    ))
}
