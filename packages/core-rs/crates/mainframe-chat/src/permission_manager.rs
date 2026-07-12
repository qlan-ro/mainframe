//! Ported from `packages/core/src/chat/permission-manager.ts`.

use std::collections::{HashMap, HashSet, VecDeque};

use mainframe_types::adapter::ControlRequest;
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;

/// Per-chat FIFO of pending permission requests + the interrupted flag.
///
/// CONCURRENCY.tsv (`permission-manager.ts`): `pendingPermissions` and
/// `interruptedChats` are PER_ENTITY — they fold into `ChatState.pending_permissions:
/// VecDeque<ControlRequest>` (front is active) and `ChatState.interrupted: bool`.
/// The multi-`control_request`-per-turn FIFO is load-bearing (a chat can hold
/// several queued permission prompts; the front is answered first).
#[derive(Default)]
pub struct PermissionManager {
    pending_permissions: HashMap<String, VecDeque<ControlRequest>>,
    interrupted_chats: HashSet<String>,
}

impl PermissionManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get_pending(&self, chat_id: &str) -> Option<&ControlRequest> {
        self.pending_permissions
            .get(chat_id)
            .and_then(|q| q.front())
    }

    pub fn has_pending(&self, chat_id: &str) -> bool {
        self.pending_permissions
            .get(chat_id)
            .is_some_and(|q| !q.is_empty())
    }

    pub fn matches_pending(&self, chat_id: &str, request_id: &str) -> bool {
        self.pending_permissions
            .get(chat_id)
            .and_then(|q| q.front())
            .is_some_and(|front| front.request_id == request_id)
    }

    pub fn clear(&mut self, chat_id: &str) {
        self.pending_permissions.remove(chat_id);
        self.interrupted_chats.remove(chat_id);
    }

    /// Enqueue a request; returns true when it becomes the active (front) request.
    pub fn enqueue(&mut self, chat_id: &str, request: ControlRequest) -> bool {
        let queue = self
            .pending_permissions
            .entry(chat_id.to_string())
            .or_default();
        queue.push_back(request);
        queue.len() == 1
    }

    /// Drop the front request; returns the new front, or `None` when the queue empties.
    pub fn shift(&mut self, chat_id: &str) -> Option<ControlRequest> {
        let queue = self.pending_permissions.get_mut(chat_id)?;
        queue.pop_front();
        if queue.is_empty() {
            self.pending_permissions.remove(chat_id);
            return None;
        }
        queue.front().cloned()
    }

    pub fn mark_interrupted(&mut self, chat_id: &str) {
        self.interrupted_chats.insert(chat_id.to_string());
    }

    pub fn clear_interrupted(&mut self, chat_id: &str) -> bool {
        self.interrupted_chats.remove(chat_id)
    }

    pub fn restore_pending_permission(&mut self, chat_id: &str, messages: &[ChatMessage]) {
        if self.has_pending(chat_id) {
            return;
        }

        let mut answered_tool_use_ids: HashSet<String> = HashSet::new();
        for msg in messages.iter().rev() {
            let has_user_text = msg.r#type == ChatMessageType::User
                && msg
                    .content
                    .iter()
                    .any(|b| matches!(b, MessageContent::Leaf(LeafContent::Text { .. })));

            if has_user_text {
                return;
            }

            if msg.r#type == ChatMessageType::Assistant
                && !msg
                    .content
                    .iter()
                    .any(|b| matches!(b, MessageContent::Node(MessageContentNode::ToolUse { .. })))
            {
                return;
            }

            for block in &msg.content {
                match block {
                    MessageContent::Node(MessageContentNode::ToolResult {
                        tool_use_id,
                        content,
                        is_error,
                        ..
                    }) => {
                        let is_permission_failure =
                            *is_error && content.contains("permission request failed");
                        if !is_permission_failure {
                            answered_tool_use_ids.insert(tool_use_id.clone());
                        }
                    }
                    MessageContent::Node(MessageContentNode::ToolUse {
                        id, name, input, ..
                    }) => {
                        if !answered_tool_use_ids.contains(id) {
                            self.pending_permissions.insert(
                                chat_id.to_string(),
                                VecDeque::from([ControlRequest {
                                    request_id: String::new(),
                                    tool_name: name.clone(),
                                    tool_use_id: id.clone(),
                                    input: input.clone(),
                                    suggestions: Vec::new(),
                                    decision_reason: None,
                                }]),
                            );
                        }
                        return;
                    }
                    _ => {}
                }
            }
        }
    }
}

// PORT STATUS: src/chat/permission-manager.ts (90 lines)
// confidence: high
// todos: 0
// notes: `pendingPermissions: Map<string, ControlRequest[]>` → `HashMap<String,
// notes: VecDeque<ControlRequest>>` (FIFO, front = active). `shift` returns the NEW
// notes: front (or None when drained), matching the TS `queue[0]` return; the absent-
// notes: chat branch returns None instead of building a throwaway array. TS block
// notes: `type` checks map onto the untagged MessageContent (Leaf/Node) arms;
// notes: ControlRequest gains `decision_reason: None` (field added in the Rust type).
