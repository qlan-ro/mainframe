use mainframe_orchestration::{errors::ToolError, input::check_id};
use mainframe_types::settings::ExecutionMode;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ListInput {
    pub project_id: String,
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "page_size")]
    pub limit: usize,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReadInput {
    pub chat_id: String,
    pub after_message_id: Option<String>,
    pub message_id: Option<String>,
    #[serde(default)]
    pub text_offset: usize,
    #[serde(default = "page_size")]
    pub limit: usize,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LaunchInput {
    pub project_id: String,
    pub adapter_id: String,
    pub model: Option<String>,
    pub permission_mode: Option<ExecutionMode>,
    pub prompt: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SendInput {
    pub chat_id: String,
    pub text: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ChatInput {
    pub chat_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConfigureInput {
    pub chat_id: String,
    pub adapter_id: Option<String>,
    pub model: Option<String>,
    pub permission_mode: Option<ExecutionMode>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WaitInput {
    pub chat_id: String,
    pub timeout_ms: Option<u64>,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Allow,
    Deny,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AnswerInput {
    pub chat_id: String,
    pub request_id: String,
    pub decision: Decision,
    pub answers: Option<serde_json::Map<String, serde_json::Value>>,
    pub message: Option<String>,
}

pub fn parse<T: serde::de::DeserializeOwned>(args: serde_json::Value) -> Result<T, ToolError> {
    serde_json::from_value(args)
        .map_err(|_| ToolError::invalid("Arguments do not match this tool's schema"))
}

pub fn text(value: &str) -> Result<(), ToolError> {
    if value.trim().is_empty() || value.chars().count() > 32_000 {
        return Err(ToolError::invalid(
            "Text must contain 1 to 32000 characters",
        ));
    }
    Ok(())
}

pub fn page(limit: usize, offset: usize) -> Result<(), ToolError> {
    if !(1..=50).contains(&limit) || offset > 100_000 {
        return Err(ToolError::invalid(
            "limit must be 1 to 50; offset must be 0 to 100000",
        ));
    }
    Ok(())
}

pub fn id(value: &str) -> Result<(), ToolError> {
    check_id("id", value)
}
fn page_size() -> usize {
    20
}
