use super::*;

impl<D: EventHandlerDeps + 'static> SessionSinkImpl<D> {
    pub(super) fn emit_display(&self) {
        let categories = self.deps.get_tool_categories(&self.chat_id);
        emit_display_for(
            &self.chat_id,
            &self.messages,
            &self.partial_overlays,
            categories.as_ref(),
            self.deps.as_ref(),
            self.chat_surface.get(),
        );
    }

    /// This sink's own key into [`PartialOverlays`] — `built_for_session_id`
    /// when known, matching the session-id guard `on_exit` already applies.
    pub(super) fn session_key(&self) -> &str {
        self.built_for_session_id.as_deref().unwrap_or_default()
    }

    /// Remove THIS session's overlay entry; reports whether one was present
    /// so abort paths (retry, result, exit) only re-emit when content
    /// vanishes. Never touches a different session's overlay for the same
    /// chat (T13, R3.19).
    pub(super) fn take_partial_overlay(&self) -> bool {
        self.partial_overlays
            .take(&self.chat_id, self.session_key())
    }

    pub(super) fn notify_surface(&self, event: ChatSurfaceEvent) {
        chat_surface::notify(self.chat_surface.get(), event);
    }

    pub(super) fn append_and_display(&self, message: ChatMessage) {
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .append(&self.chat_id, message);
        self.emit_display();
    }

    pub(super) fn transient(
        &self,
        r#type: ChatMessageType,
        content: Vec<MessageContent>,
        metadata: Option<HashMap<String, serde_json::Value>>,
    ) -> ChatMessage {
        self.transient_with_id(r#type, content, metadata, None)
    }

    /// `transient`, with an adapter-supplied id in place of a minted nanoid
    /// (todo #350 group B, stable-ids task 5).
    pub(super) fn transient_with_id(
        &self,
        r#type: ChatMessageType,
        content: Vec<MessageContent>,
        metadata: Option<HashMap<String, serde_json::Value>>,
        vendor_id: Option<String>,
    ) -> ChatMessage {
        self.messages
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .create_transient_message_with_vendor_id(
                &self.chat_id,
                r#type,
                content,
                metadata,
                vendor_id,
            )
    }

    /// Emits `PermissionRequested` (plus its push, when notify-worthy) for the
    /// request now at the front of the queue, then a `ChatUpdated` — mirroring
    /// what `on_permission` emits for a freshly enqueued front request.
    pub(super) fn promote_next(&self, next: Option<ControlRequest>) {
        if let Some(next) = next {
            let notify = self.deps.should_notify_permission(Some(&next.tool_name));
            self.notify_surface(ChatSurfaceEvent::GateRaised {
                chat_id: self.chat_id.clone(),
                request: next.clone(),
            });
            if notify {
                let tool = &next.tool_name;
                self.deps.send_push(PushOut {
                    chat_id: self.chat_id.clone(),
                    title: "Permission Required".to_string(),
                    body: format!("Agent wants to run: {tool}"),
                    push_type: "permission".to_string(),
                    priority: "high".to_string(),
                });
            }
        }
        if let Some(cell) = self.deps.get_active_chat(&self.chat_id) {
            let chat = cell.lock().unwrap_or_else(|e| e.into_inner()).chat.clone();
            self.deps
                .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });
        }
    }
}

impl<D: EventHandlerDeps + 'static> SessionSink for SessionSinkImpl<D> {
    fn on_message_with_presentation(
        &self,
        content: Vec<MessageContent>,
        metadata: Option<MessageMetadata>,
        presentation: mainframe_types::transcript_presentation::TranscriptPresentation,
    ) {
        self.handle_message(content, metadata, Some(presentation));
    }
    fn on_message_partial_with_presentation(
        &self,
        api_message_id: &str,
        content: Vec<MessageContent>,
        presentation: mainframe_types::transcript_presentation::TranscriptPresentation,
    ) {
        self.partial_with_presentation(api_message_id, content, presentation);
    }
    fn on_presentation_update(
        &self,
        presentation: mainframe_types::transcript_presentation::PresentationUpdate,
    ) {
        self.update_presentation(presentation);
    }
    fn on_init(&self, session_id: &str) {
        self.handle_init(session_id);
    }
    fn on_message(&self, content: Vec<MessageContent>, metadata: Option<MessageMetadata>) {
        self.handle_message(content, metadata, None);
    }
    fn on_tool_result(&self, content: Vec<MessageContent>, vendor_id: Option<String>) {
        self.handle_tool_result(content, vendor_id);
    }
    fn on_permission(&self, request: ControlRequest) {
        self.handle_permission(request);
    }
    fn on_permission_cancelled(&self, request_id: &str) {
        self.handle_permission_cancelled(request_id);
    }
    fn on_result(&self, data: SessionResult) {
        self.handle_result(data);
    }
    fn on_queued_processed(&self, uuid: &str) {
        self.handle_queued_processed(uuid);
    }
    fn on_exit(&self, _code: Option<i32>) {
        self.handle_exit(_code);
    }
    fn on_error(&self, error: mainframe_adapter_api::AdapterError) {
        self.handle_error(error);
    }
    fn on_compact(&self, vendor_id: Option<&str>) {
        self.handle_compact(vendor_id);
    }
    fn on_compact_start(&self) {
        self.handle_compact_start();
    }
    fn on_context_usage(&self, usage: ContextUsage) {
        self.handle_context_usage(usage);
    }
    fn on_plan_file(&self, file_path: &str) {
        self.handle_plan_file(file_path);
    }
    fn on_skill_file(&self, entry: SkillFileEntry) {
        self.handle_skill_file(entry);
    }
    fn on_todo_update(&self, todos: Vec<TodoItem>) {
        self.handle_todo_update(todos);
    }
    fn on_pr_detected(&self, pr: DetectedPr) {
        self.handle_pr_detected(pr);
    }
    fn on_cli_message(&self, text: &str) {
        self.handle_cli_message(text);
    }
    fn on_skill_loaded(&self, entry: mainframe_adapter_api::LoadedSkill) {
        self.handle_skill_loaded(entry);
    }
    fn on_subagent_child(&self, parent_tool_use_id: &str, blocks: Vec<MessageContent>) {
        self.handle_subagent_child(parent_tool_use_id, blocks);
    }
    fn on_trust_required(&self, project_path: &str) {
        self.handle_trust_required(project_path);
    }
    fn on_provider_quota(&self, adapter_id: &str, quota: ProviderQuota) {
        self.handle_provider_quota(adapter_id, quota);
    }
    fn on_api_retry(&self, attempt: i64, reason: Option<String>) {
        self.handle_api_retry(attempt, reason);
    }
    fn on_message_partial(&self, api_message_id: &str, content: Vec<MessageContent>) {
        self.handle_message_partial(api_message_id, content);
    }
    fn on_attention_request(&self, message: &str) {
        self.handle_attention_request(message);
    }
}
