//! A chat's pending prompt as an external client sees it: enough to say it
//! aloud and to answer it through `chat_answer`.

use mainframe_acp::gates::offered_options;
use mainframe_orchestration::{errors::cap_chars, ports::ChatView};
use mainframe_types::{
    acp::permission::PermissionOptionKind, adapter::ControlRequest, external_mcp::ExternalMcpClient,
};
use serde_json::{Value, json};

use super::mutations::ceiling;

const SUMMARY_CHARS: usize = 2_000;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Permission,
    Question,
    Plan,
}

impl Kind {
    pub fn of(request: &ControlRequest) -> Self {
        match request.tool_name.as_str() {
            "AskUserQuestion" => Self::Question,
            "ExitPlanMode" => Self::Plan,
            _ => Self::Permission,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Permission => "permission",
            Self::Question => "question",
            Self::Plan => "plan",
        }
    }
}

pub struct Question {
    pub text: String,
    pub options: Vec<String>,
    pub multi_select: bool,
}

/// The questions an `AskUserQuestion` request carries; empty when the input
/// has none this build can read.
pub fn questions(request: &ControlRequest) -> Vec<Question> {
    let Some(list) = request.input.get("questions").and_then(Value::as_array) else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|q| {
            let text = q.get("question")?.as_str()?.to_owned();
            let options = q
                .get("options")
                .and_then(Value::as_array)
                .map(|options| {
                    options
                        .iter()
                        .filter_map(|o| o.get("label")?.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default();
            let multi_select = q.get("multiSelect").and_then(Value::as_bool) == Some(true);
            Some(Question {
                text,
                options,
                multi_select,
            })
        })
        .collect()
}

/// Whether the adapter offered a one-time approval. A gate that offers only
/// a rejection must not become approvable here.
pub fn allow_offered(request: &ControlRequest) -> bool {
    offered_options(request)
        .iter()
        .any(|option| option.kind == PermissionOptionKind::AllowOnce)
}

/// A prompt restored from the transcript after a daemon restart has no
/// request id to answer against.
pub fn answerable(client: &ExternalMcpClient, chat: &ChatView, request: &ControlRequest) -> bool {
    client.answer_prompts
        && !request.request_id.is_empty()
        && ceiling(client, &chat.adapter_id, chat.permission_mode).is_ok()
}

pub fn view(client: &ExternalMcpClient, chat: &ChatView, request: &ControlRequest) -> Value {
    let kind = Kind::of(request);
    let input = serde_json::to_string(&request.input).unwrap_or_default();
    let questions: Vec<Value> = questions(request)
        .into_iter()
        .map(|q| json!({"question": q.text, "options": q.options, "multiSelect": q.multi_select}))
        .collect();
    json!({
        "requestId": request.request_id,
        "kind": kind.as_str(),
        "toolName": request.tool_name,
        "summary": cap_chars(&input, SUMMARY_CHARS),
        "questions": if kind == Kind::Question { json!(questions) } else { Value::Null },
        "canAllow": allow_offered(request),
        "answerable": answerable(client, chat, request),
    })
}
