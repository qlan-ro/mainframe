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
}

/// An action that clears a prompt refusal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptRemedy {
    /// The provider archived the chat's native session outside Mainframe:
    /// `POST /api/chats/{id}/native-session/unarchive`, then retry.
    UnarchiveNativeSession,
}
