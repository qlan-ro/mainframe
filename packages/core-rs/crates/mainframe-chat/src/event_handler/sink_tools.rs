use super::*;

impl<D: EventHandlerDeps + 'static> SessionSinkImpl<D> {
    pub(super) fn handle_tool_result(
        &self,
        content: Vec<MessageContent>,
        vendor_id: Option<String>,
    ) {
        let message = self.transient_with_id(
            ChatMessageType::ToolResult,
            content.clone(),
            None,
            vendor_id,
        );
        self.append_timed_and_display(message);
        let mut effects = ToolEffects::default();
        for block in &content {
            if let MessageContent::Node(MessageContentNode::ToolResult {
                tool_use_id,
                is_error: false,
                ..
            }) = block
            {
                self.collect_tool_effects(tool_use_id, &mut effects);
            }
        }
        self.emit_tool_effects(effects);
    }
    fn collect_tool_effects(&self, tool_use_id: &str, effects: &mut ToolEffects) {
        let fp = self.pending_file_paths.lock_recover().remove(tool_use_id);
        if let Some(fp) = fp {
            effects.edited_paths.push(fp);
        }
        if self.pending_subagent_ids.lock_recover().remove(tool_use_id) {
            effects.subagent_completed = true;
        }
        if self
            .pending_worktree_triggers
            .lock_recover()
            .remove(tool_use_id)
        {
            effects.worktree_trigger = true;
        }
        if self
            .pending_transcript_moves
            .lock_recover()
            .remove(tool_use_id)
        {
            effects.transcript_moved = true;
        }
    }
    fn emit_tool_effects(&self, effects: ToolEffects) {
        // Once per batch: two `git worktree add`s in one turn need one rescan.
        if effects.worktree_trigger {
            self.deps.on_worktree_trigger(&self.chat_id);
        }
        if effects.transcript_moved {
            self.deps.on_transcript_moved(&self.chat_id);
        }

        if !effects.edited_paths.is_empty() {
            self.deps.emit_event(DaemonEvent::ContextUpdated {
                chat_id: self.chat_id.clone(),
                file_paths: Some(effects.edited_paths),
            });
        } else if effects.subagent_completed {
            self.deps.emit_event(DaemonEvent::ContextUpdated {
                chat_id: self.chat_id.clone(),
                file_paths: None,
            });
        }
    }
}

#[derive(Default)]
struct ToolEffects {
    edited_paths: Vec<String>,
    subagent_completed: bool,
    worktree_trigger: bool,
    transcript_moved: bool,
}
