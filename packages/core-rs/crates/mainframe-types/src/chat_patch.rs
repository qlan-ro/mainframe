use crate::{
    chat::{ChatStatus, ProcessState},
    context::SessionMention,
    settings::ExecutionMode,
};

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adapter_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<ChatStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens_input: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens_output: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_context_tokens_input: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_context_total_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_context_max_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<ExecutionMode>,
    #[serde(
        default,
        deserialize_with = "crate::serde_util::double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub worktree_path: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "crate::serde_util::double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub branch_name: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mentions: Option<Vec<SessionMention>>,
    #[serde(
        default,
        deserialize_with = "crate::serde_util::double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub process_state: Option<Option<ProcessState>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_mode: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcript_missing: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor_session_ephemeral: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_lost_at: Option<String>,
    #[serde(flatten)]
    pub tuning: crate::chat::SessionTuning,
}

impl std::ops::Deref for ChatPatch {
    type Target = crate::chat::SessionTuning;
    fn deref(&self) -> &Self::Target {
        &self.tuning
    }
}
impl std::ops::DerefMut for ChatPatch {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.tuning
    }
}
