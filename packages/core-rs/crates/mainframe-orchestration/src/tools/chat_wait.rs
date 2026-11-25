//! `chat_wait`: block until a chat is idle, waiting for permission, or ended.

use std::time::Duration;

use serde::Deserialize;
use serde_json::{Value, json};

use super::ToolDef;
use crate::calls::CallCtx;
use crate::errors::{ErrorCode, ToolError, cap_chars};
use crate::input::{
    Validate, check_id, check_timeout, id_schema, object_schema, parse_args, timeout_schema,
};
use crate::policy::{DEFAULT_WAIT_MS, LAST_TEXT_CAP, MAX_SINGLE_WAIT_MS};
use crate::ports::ChatView;
use crate::service::OrchestrationService;
use crate::state::{ChatState, last_assistant_text};
use crate::waiter::{WaitEnd, wait_for};

pub(super) fn definition() -> ToolDef {
    ToolDef {
        title: "Wait for a Mainframe chat",
        description: "Block until a chat is idle, waiting for a permission answer, or ended \
            (default: any of these), or until timeoutMs passes. Returns the chat's state, its \
            last assistant text, and any pending permission. A timeout never affects the chat. \
            Each call actually blocks for well under a minute regardless of timeoutMs: when the \
            caller's own budget is not yet used up, it returns early with stillWaiting true, \
            waitTimedOut false, and remainingMs set — call chat_wait again with timeoutMs: \
            remainingMs to keep waiting. waitTimedOut only becomes true once a call's own \
            (possibly reduced) timeoutMs is itself used up with nothing happening. Prefer ending \
            your turn over long waits when nothing depends on the answer.",
        input_schema: object_schema(
            json!({
                "chatId": id_schema("The chat to wait on."),
                "until": {
                    "type": "array",
                    "items": { "enum": ["idle", "waiting_for_permission", "ended"] },
                    "minItems": 1,
                    "uniqueItems": true
                },
                "timeoutMs": timeout_schema("Default 600000 (10 minutes).")
            }),
            &["chatId"],
        ),
        read_only: true,
        destructive: false,
        idempotent: true,
    }
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Until {
    Idle,
    WaitingForPermission,
    Ended,
}

impl Until {
    fn matches(self, state: ChatState) -> bool {
        match self {
            Self::Idle => state == ChatState::Idle,
            Self::WaitingForPermission => state == ChatState::WaitingForPermission,
            Self::Ended => matches!(state, ChatState::Ended | ChatState::Archived),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Input {
    chat_id: String,
    until: Option<Vec<Until>>,
    timeout_ms: Option<u64>,
}

impl Validate for Input {
    fn validate(&self) -> Result<(), ToolError> {
        check_id("chatId", &self.chat_id)?;
        if self.until.as_ref().is_some_and(Vec::is_empty) {
            return Err(ToolError::invalid("until must name at least one state"));
        }
        check_timeout("timeoutMs", self.timeout_ms)
    }
}

pub(super) async fn run(
    svc: &OrchestrationService,
    ctx: &CallCtx,
    args: Value,
) -> Result<Value, ToolError> {
    let input: Input = parse_args(args)?;
    let caller = svc.caller_chat(ctx).await?;
    if input.chat_id == caller.id {
        return Err(ToolError::new(
            ErrorCode::InvalidRequest,
            "A chat may not wait on itself.",
        ));
    }
    svc.target_chat(&input.chat_id, &caller).await?;
    let until = input
        .until
        .unwrap_or_else(|| vec![Until::Idle, Until::WaitingForPermission, Until::Ended]);
    let _slot = ctx.caller.begin_wait()?;
    let requested = Duration::from_millis(input.timeout_ms.unwrap_or(DEFAULT_WAIT_MS));
    let capped = requested.min(Duration::from_millis(MAX_SINGLE_WAIT_MS));
    let watched = [input.chat_id.clone()];
    let probe = || async {
        let chat = svc.port.chat(&input.chat_id).await.ok().flatten()?;
        let state = svc.state_of(&chat);
        until
            .iter()
            .any(|u| u.matches(state))
            .then_some((chat, state))
    };
    match wait_for(svc, ctx, capped, &watched, probe).await {
        WaitEnd::Matched((chat, state)) => Ok(result(svc, &chat, Ending::Matched(state)).await),
        WaitEnd::TimedOut => {
            let chat = svc.target_chat(&input.chat_id, &caller).await?;
            let ending = Ending::after_timeout(requested, capped);
            Ok(result(svc, &chat, ending).await)
        }
        WaitEnd::Cancelled => Err(CallCtx::wait_cancelled()),
    }
}

/// How one `chat_wait` call ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ending {
    Matched(ChatState),
    /// The per-call cap ended the call with this much of the caller's own
    /// budget left. Reporting what is left of the original budget, rather than
    /// a fresh one per call, is what lets a retry loop end.
    StillWaiting {
        remaining_ms: u64,
    },
    TimedOut,
}

impl Ending {
    fn after_timeout(requested: Duration, capped: Duration) -> Self {
        let remaining = requested.saturating_sub(capped);
        if remaining.is_zero() {
            return Self::TimedOut;
        }
        Self::StillWaiting {
            remaining_ms: u64::try_from(remaining.as_millis()).unwrap_or(u64::MAX),
        }
    }
}

async fn result(svc: &OrchestrationService, chat: &ChatView, ending: Ending) -> Value {
    let text = last_assistant_text(&svc.port.messages(&chat.id).await);
    let (matched, remaining_ms) = match ending {
        Ending::Matched(state) => (Some(state), None),
        Ending::StillWaiting { remaining_ms } => (None, Some(remaining_ms)),
        Ending::TimedOut => (None, None),
    };
    json!({
        "chatId": chat.id,
        "state": matched.unwrap_or_else(|| svc.state_of(chat)),
        "matched": matched,
        "waitTimedOut": ending == Ending::TimedOut,
        "stillWaiting": remaining_ms.is_some(),
        "remainingMs": remaining_ms,
        "lastAssistantText": (!text.is_empty()).then(|| cap_chars(&text, LAST_TEXT_CAP)),
        "pendingPermission": chat.pending_permission.as_ref()
            .map(|p| json!({ "toolName": p.tool_name, "summary": p.summary })),
    })
}

#[cfg(test)]
#[path = "chat_wait_tests.rs"]
mod tests;
