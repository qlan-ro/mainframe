use super::*;

impl<D: EventHandlerDeps + 'static> SessionSinkImpl<D> {
    pub(super) fn handle_message(
        &self,
        content: Vec<MessageContent>,
        metadata: Option<MessageMetadata>,
        presentation: Option<mainframe_types::transcript_presentation::TranscriptPresentation>,
    ) {
        debug!(
            chat_id = self.chat_id,
            block_count = content.len(),
            "assistant message received"
        );

        if !content.iter().any(has_child_owner)
            && presentation
                .as_ref()
                .and_then(|p| p.parent_tool_use_id.as_ref())
                .is_none()
        {
            self.take_partial_overlay();
        }

        self.promote_working();
        self.track_tools(&content);
        self.enter_plan_mode(&content);
        let cleaned = self.clean_content(content);
        let (mut meta, vendor_id) = self.message_metadata(metadata);
        if let Some(context) = presentation.filter(|p| p.is_valid())
            && let Ok(value) = serde_json::to_value(context)
        {
            meta.insert(
                mainframe_types::transcript_presentation::PRESENTATION_CONTEXT_KEY.into(),
                value,
            );
        }
        let message =
            self.transient_with_id(ChatMessageType::Assistant, cleaned, Some(meta), vendor_id);
        self.append_timed_and_display(message);
    }
    fn promote_working(&self) {
        if let Some(cell) = self.deps.get_active_chat(&self.chat_id) {
            let updated = {
                let mut guard = cell.lock_recover();
                if guard.chat.process_state != Some(Some(ProcessState::Working)) {
                    guard.chat.process_state = Some(Some(ProcessState::Working));
                    Some(guard.chat.clone())
                } else {
                    None
                }
            };
            if let Some(chat) = updated {
                self.deps.chats_update(
                    &self.chat_id,
                    &EventChatUpdate {
                        process_state: Some(Some(ProcessState::Working)),
                        ..Default::default()
                    },
                );
                self.deps
                    .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });
            }
        }
    }
    fn track_tools(&self, content: &[MessageContent]) {
        let categories = self.deps.get_tool_categories(&self.chat_id);
        for block in content {
            if let MessageContent::Node(MessageContentNode::ToolUse {
                id, name, input, ..
            }) = block
            {
                if (name == "Write" || name == "Edit")
                    && let Some(fp) = input.get("file_path").and_then(|v| v.as_str())
                {
                    self.pending_file_paths
                        .lock_recover()
                        .insert(id.clone(), fp.to_string());
                }
                if categories
                    .as_ref()
                    .is_some_and(|c| c.subagent.contains(name))
                {
                    self.pending_subagent_ids.lock_recover().insert(id.clone());
                }
                if creates_worktree(name, input) {
                    self.pending_worktree_triggers
                        .lock_recover()
                        .insert(id.clone());
                }
                if moves_transcript(name) {
                    self.pending_transcript_moves
                        .lock_recover()
                        .insert(id.clone());
                }
            }
        }
    }
    fn enter_plan_mode(&self, content: &[MessageContent]) {
        let has_enter_plan_mode = content.iter().any(|b| {
            matches!(b, MessageContent::Node(MessageContentNode::ToolUse { name, .. }) if name == "EnterPlanMode")
        });
        if has_enter_plan_mode && let Some(cell) = self.deps.get_active_chat(&self.chat_id) {
            let updated = {
                let mut guard = cell.lock_recover();
                if guard.chat.plan_mode != Some(true) {
                    guard.chat.plan_mode = Some(true);
                    Some(guard.chat.clone())
                } else {
                    None
                }
            };
            if let Some(chat) = updated {
                self.deps.chats_update(
                    &self.chat_id,
                    &EventChatUpdate {
                        plan_mode: Some(true),
                        ..Default::default()
                    },
                );
                self.deps
                    .emit_event(DaemonEvent::ChatUpdated { chat, reason: None });
            }
        }
    }
    pub(super) fn clean_content(&self, content: Vec<MessageContent>) -> Vec<MessageContent> {
        content
            .into_iter()
            .map(|block| match block {
                MessageContent::Leaf(LeafContent::Text {
                    text,
                    parent_tool_use_id,
                }) => {
                    let stripped = self.deps.strip_command_tags(&text);
                    MessageContent::Leaf(LeafContent::Text {
                        text: stripped,
                        parent_tool_use_id,
                    })
                }
                other => other,
            })
            .collect()
    }
    fn message_metadata(
        &self,
        metadata: Option<MessageMetadata>,
    ) -> (HashMap<String, serde_json::Value>, Option<String>) {
        let adapter_id = self.deps.get_active_chat(&self.chat_id).and_then(|c| {
            c.lock_recover()
                .session
                .as_ref()
                .map(|s| s.adapter_id().to_string())
        });
        let mut meta: HashMap<String, serde_json::Value> = HashMap::new();
        if let Some(a) = adapter_id {
            meta.insert("adapterId".to_string(), serde_json::Value::String(a));
        }
        let mut vendor_id = None;
        if let Some(m) = metadata {
            vendor_id = m.vendor_id;
            if let Some(model) = m.model {
                meta.insert("model".to_string(), serde_json::Value::String(model));
            }
            if let Some(usage) = m.usage
                && let Ok(v) = serde_json::to_value(usage)
            {
                meta.insert("usage".to_string(), v);
            }
        }
        (meta, vendor_id)
    }
}

fn has_child_owner(content: &MessageContent) -> bool {
    let parent = match content {
        MessageContent::Leaf(
            LeafContent::Text {
                parent_tool_use_id, ..
            }
            | LeafContent::Thinking {
                parent_tool_use_id, ..
            }
            | LeafContent::Image {
                parent_tool_use_id, ..
            }
            | LeafContent::SkillLoaded {
                parent_tool_use_id, ..
            },
        ) => parent_tool_use_id,
        MessageContent::Node(
            MessageContentNode::ToolUse {
                parent_tool_use_id, ..
            }
            | MessageContentNode::ToolResult {
                parent_tool_use_id, ..
            }
            | MessageContentNode::PermissionRequest {
                parent_tool_use_id, ..
            }
            | MessageContentNode::Error {
                parent_tool_use_id, ..
            }
            | MessageContentNode::Compaction { parent_tool_use_id },
        ) => parent_tool_use_id,
        MessageContent::Node(MessageContentNode::ProviderSwitch { .. }) => return false,
    };
    parent.as_deref().is_some_and(|id| !id.is_empty())
}
