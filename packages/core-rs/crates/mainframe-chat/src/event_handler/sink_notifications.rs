use super::*;

impl<D: EventHandlerDeps + 'static> SessionSinkImpl<D> {
    pub(super) fn handle_cli_message(&self, text: &str) {
        let message = self.transient(
            ChatMessageType::System,
            vec![MessageContent::Leaf(LeafContent::Text {
                text: text.to_string(),
                parent_tool_use_id: None,
            })],
            None,
        );
        self.append_and_display(message);
    }

    pub(super) fn handle_skill_loaded(&self, entry: mainframe_adapter_api::LoadedSkill) {
        let message = self.transient(
            ChatMessageType::System,
            vec![MessageContent::Leaf(LeafContent::SkillLoaded {
                skill_name: entry.skill_name,
                path: entry.path,
                content: entry.content,
                parent_tool_use_id: None,
            })],
            None,
        );
        self.append_and_display(message);
    }

    pub(super) fn handle_subagent_child(
        &self,
        parent_tool_use_id: &str,
        blocks: Vec<MessageContent>,
    ) {
        self.append_timed_children(parent_tool_use_id, blocks);
    }

    pub(super) fn handle_trust_required(&self, project_path: &str) {
        self.deps.emit_event(DaemonEvent::ChatTrustRequired {
            chat_id: self.chat_id.clone(),
            project_path: project_path.to_string(),
        });
    }

    pub(super) fn handle_provider_quota(&self, adapter_id: &str, quota: ProviderQuota) {
        self.deps.on_provider_quota(adapter_id, quota);
    }

    pub(super) fn handle_api_retry(&self, attempt: i64, reason: Option<String>) {
        // The marker must be recorded before the clearing revision it
        // precedes (T16, R1.4): the hub attaches a pending marker to the
        // first eligible upsert on the NEXT revision, and the display
        // revision below is that revision's trigger — recording the marker
        // after emitting it would let the clearing frame go out unmarked.
        self.notify_surface(ChatSurfaceEvent::Retry {
            chat_id: self.chat_id.clone(),
            attempt,
            reason,
        });
        // The retried API call re-streams from scratch under a fresh message
        // id — the aborted call's partial content must disappear now, not
        // linger until the retry's first block lands.
        if self.take_partial_overlay() {
            self.emit_display();
        }
    }

    pub(super) fn handle_message_partial(
        &self,
        api_message_id: &str,
        content: Vec<MessageContent>,
    ) {
        let stripped = self.clean_content(content);
        self.partial_overlays
            .insert(&self.chat_id, self.session_key(), api_message_id, stripped);
        self.emit_display();
    }

    pub(super) fn handle_attention_request(&self, message: &str) {
        let Some(attention) = normalize_attention_body(message) else {
            return;
        };
        if !self.deps.notify_attention_request() {
            return;
        }
        let admitted = self
            .attention_dedupe
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .admit(&self.chat_id, &attention.dedupe_key, Instant::now());
        if !admitted {
            return;
        }
        self.deps.emit_event(DaemonEvent::ChatNotification {
            chat_id: self.chat_id.clone(),
            title: "Claude needs your attention".to_string(),
            body: attention.body.clone(),
            level: ChatNotificationLevel::Success,
            kind: Some(ChatNotificationKind::AttentionRequest),
        });
        self.deps.send_push(PushOut {
            chat_id: self.chat_id.clone(),
            title: "Claude needs your attention".to_string(),
            body: attention.body,
            push_type: "attention_request".to_string(),
            priority: "high".to_string(),
        });
    }
}
