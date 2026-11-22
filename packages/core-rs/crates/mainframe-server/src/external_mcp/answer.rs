//! `chat_answer`: resolve a chat's pending prompt on the user's behalf. Only
//! for clients granted `answer_prompts`. Every answer is a one-time decision:
//! no rule is saved, the session is not pre-approved, and a plan approval
//! keeps the chat's current permission mode.

use std::collections::HashMap;

use mainframe_orchestration::errors::{ErrorCode, ToolError};
use mainframe_types::{
    adapter::{ControlBehavior, ControlRequest, ControlResponse},
    external_mcp::ExternalMcpClient,
};
use serde_json::{Map, Value, json};

use super::{
    input::{AnswerInput, Decision},
    mutations::writable,
    prompt::{self, Kind, Question},
};
use crate::ctx::AppCtx;

const MESSAGE_CHARS: usize = 2_000;
const ANSWER_CHARS: usize = 2_000;

pub async fn answer(
    ctx: &AppCtx,
    client: &ExternalMcpClient,
    input: AnswerInput,
) -> Result<Value, ToolError> {
    let chat = writable(ctx, client, &input.chat_id).await?;
    let chats = &ctx.chat.chat_manager;
    let request = chats
        .get_pending_permission(&chat.id)
        .await
        .filter(|r| !r.request_id.is_empty() && r.request_id == input.request_id)
        .ok_or_else(|| {
            ToolError::new(
                ErrorCode::ChatNotSendable,
                "That prompt is no longer pending; call chat_wait for the chat's current state",
            )
        })?;
    let mut response = match input.decision {
        Decision::Allow => allow(&request, input.answers, input.message.is_some())?,
        Decision::Deny => deny(client, &request, input.answers.is_some(), input.message)?,
    };
    if response.behavior == ControlBehavior::Allow && Kind::of(&request) == Kind::Plan {
        // Approving a plan leaves plan mode; staying on the chat's own mode
        // keeps the approval inside the ceiling `writable` just checked.
        response.execution_mode = Some(chat.permission_mode);
    }
    let allowed = response.behavior == ControlBehavior::Allow;
    chats
        .respond_to_permission(&chat.id, response)
        .await
        .map_err(|_| {
            ToolError::new(
                ErrorCode::ChatNotSendable,
                "The answer could not be delivered; check the chat in Mainframe",
            )
        })?;
    tracing::info!(external_client_id = %client.id, chat_id = %chat.id,
        tool_name = %request.tool_name, allowed, "external client answered prompt");
    Ok(json!({"chatId": chat.id, "requestId": request.request_id, "answered": true}))
}

fn base(request: &ControlRequest, behavior: ControlBehavior) -> ControlResponse {
    ControlResponse {
        request_id: request.request_id.clone(),
        tool_use_id: request.tool_use_id.clone(),
        tool_name: Some(request.tool_name.clone()),
        behavior,
        updated_input: None,
        updated_permissions: None,
        message: None,
        execution_mode: None,
        clear_context: None,
        scope: None,
    }
}

fn allow(
    request: &ControlRequest,
    answers: Option<Map<String, Value>>,
    has_message: bool,
) -> Result<ControlResponse, ToolError> {
    if has_message {
        return Err(ToolError::invalid("message is only sent with a denial"));
    }
    // The CLI requires the request's own input back on every approval.
    let mut updated: HashMap<String, Value> = request.input.clone();
    if Kind::of(request) == Kind::Question {
        let answers = answers.ok_or_else(|| {
            ToolError::invalid("Answer a question with answers, keyed by the question text")
        })?;
        updated.insert(
            "answers".into(),
            Value::Object(checked_answers(&prompt::questions(request), answers)?),
        );
    } else if answers.is_some() {
        return Err(ToolError::invalid("answers only applies to a question"));
    } else if !prompt::allow_offered(request) {
        return Err(ToolError::invalid(
            "This prompt cannot be approved; deny it or answer it in Mainframe",
        ));
    }
    let mut response = base(request, ControlBehavior::Allow);
    response.updated_input = Some(updated);
    Ok(response)
}

fn deny(
    client: &ExternalMcpClient,
    request: &ControlRequest,
    has_answers: bool,
    message: Option<String>,
) -> Result<ControlResponse, ToolError> {
    if has_answers {
        return Err(ToolError::invalid("answers is only sent with an approval"));
    }
    let message = message
        .map(|m| m.trim().to_owned())
        .filter(|m| !m.is_empty());
    if message
        .as_ref()
        .is_some_and(|m| m.chars().count() > MESSAGE_CHARS)
    {
        return Err(ToolError::invalid(format!(
            "message must be at most {MESSAGE_CHARS} characters"
        )));
    }
    let mut response = base(request, ControlBehavior::Deny);
    response.message = message.map(|m| format!("From external client {}: {m}", client.name));
    Ok(response)
}

/// Every question answered, nothing else: one string, or a list of strings
/// for a multi-select question.
fn checked_answers(
    questions: &[Question],
    mut answers: Map<String, Value>,
) -> Result<Map<String, Value>, ToolError> {
    if questions.is_empty() {
        return Err(ToolError::invalid(
            "This question cannot be answered here; answer it in Mainframe",
        ));
    }
    let mut checked = Map::new();
    for question in questions {
        let value = answers.remove(&question.text).ok_or_else(|| {
            ToolError::invalid(format!("Missing an answer for: {}", question.text))
        })?;
        let valid = match &value {
            Value::String(text) => answer_text(text),
            Value::Array(items) if question.multi_select => {
                !items.is_empty() && items.iter().all(|i| i.as_str().is_some_and(answer_text))
            }
            _ => false,
        };
        if !valid {
            return Err(ToolError::invalid(format!(
                "Give one answer, or a list for a multi-select question: {}",
                question.text
            )));
        }
        checked.insert(question.text.clone(), value);
    }
    if !answers.is_empty() {
        return Err(ToolError::invalid(
            "answers has a key that is not one of the questions",
        ));
    }
    Ok(checked)
}

fn answer_text(text: &str) -> bool {
    !text.trim().is_empty() && text.chars().count() <= ANSWER_CHARS
}
