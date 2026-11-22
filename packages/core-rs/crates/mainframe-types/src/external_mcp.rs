use serde::{Deserialize, Serialize};

use crate::settings::ExecutionMode;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExternalMcpAccess {
    Read,
    Control,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateExternalMcpClient {
    pub name: String,
    pub project_ids: Vec<String>,
    pub access: ExternalMcpAccess,
    pub max_permission_mode: ExecutionMode,
    /// Whether the client may answer permission prompts, questions and plan
    /// approvals through `chat_answer`. Off unless the user opts in.
    #[serde(default)]
    pub answer_prompts: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalMcpClient {
    pub id: String,
    pub name: String,
    pub project_ids: Vec<String>,
    pub access: ExternalMcpAccess,
    pub max_permission_mode: ExecutionMode,
    #[serde(default)]
    pub answer_prompts: bool,
    pub created_at: String,
    pub last_used_at: Option<String>,
}
