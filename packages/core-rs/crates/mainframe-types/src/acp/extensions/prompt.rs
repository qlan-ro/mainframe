use serde::{Deserialize, Serialize};

/// A refused `session/prompt`'s error `data["_mainframe.dev"]`: the refusal in
/// the user's words (the JSON-RPC `message` adds a "session unavailable:"
/// prefix for generic clients) and, when there is one, an action the client
/// can offer to fix it before retrying.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptFailure {
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remedy: Option<PromptRemedy>,
    /// The agent certainly did not get the prompt. Unset, it may have.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub never_delivered: bool,
}

/// An action that clears a prompt refusal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptRemedy {
    /// The provider archived the chat's native session outside Mainframe:
    /// `POST /api/chats/{id}/native-session/unarchive`, then retry.
    UnarchiveNativeSession,
}

/// A slash-command invocation riding [`PromptSendMeta`] (formerly the legacy
/// `message.send` frame's `metadata.command`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSendCommand {
    pub name: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<String>,
}

/// The send context a `session/prompt`'s `_meta["_mainframe.dev"]` carries
/// (desktop-cutover pass): uploaded attachment ids, the slash-command
/// invocation, and whether the prompt joins the running turn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PromptSendMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachment_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<MessageSendCommand>,
    /// Fold the prompt into the running turn instead of queueing it. The
    /// daemon queues it anyway when the turn cannot be steered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steer: Option<bool>,
}

impl PromptSendMeta {
    /// Only plain text can join a running turn: a steer carries no command and
    /// no attachments, so those prompts queue.
    pub fn wants_steer(&self) -> bool {
        self.steer == Some(true)
            && self.command.is_none()
            && self.attachment_ids.as_ref().is_none_or(Vec::is_empty)
    }
}

#[cfg(test)]
mod tests {
    use super::PromptSendMeta;

    #[test]
    fn only_plain_text_can_join_a_running_turn() {
        let steer = |value| serde_json::from_value::<PromptSendMeta>(value).unwrap();
        assert!(steer(serde_json::json!({ "steer": true })).wants_steer());
        assert!(steer(serde_json::json!({ "steer": true, "attachmentIds": [] })).wants_steer());
        assert!(!steer(serde_json::json!({})).wants_steer());
        assert!(
            !steer(serde_json::json!({ "steer": true, "attachmentIds": ["a1"] })).wants_steer()
        );
        assert!(
            !steer(serde_json::json!({ "steer": true, "command": { "name": "x", "source": "y" } }))
                .wants_steer()
        );
    }
}
