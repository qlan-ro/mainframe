//! `chat_wait`: block until a chat is idle, waiting for permission, or ended.

use std::time::Duration;

use serde::Deserialize;
use serde_json::{Value, json};

use super::ToolDef;
use crate::errors::{ErrorCode, ToolError, cap_chars};
use crate::input::{
    Validate, check_id, check_timeout, id_schema, object_schema, parse_args, timeout_schema,
};
use crate::policy::{DEFAULT_WAIT_MS, LAST_TEXT_CAP, MAX_SINGLE_WAIT_MS};
use crate::ports::ChatView;
use crate::service::{CallCtx, OrchestrationService};
use crate::state::{ChatState, last_assistant_text};
use crate::waiter::{WaitEnd, wait_for};

pub(super) fn definition() -> ToolDef {
    ToolDef {
        name: "chat_wait",
        title: "Wait for a Mainframe chat",
        description: "Block until a chat is idle, waiting for a permission answer, or ended \
            (default: any of these), or until timeoutMs passes. Returns the chat's state, its \
            last assistant text, and any pending permission. A timeout never affects the chat. \
            Each call is capped well under a minute regardless of timeoutMs: when the budget is \
            not yet exhausted, it returns early with stillWaiting true and waitTimedOut false — \
            call chat_wait again with the same arguments to keep waiting. Prefer ending your \
            turn over long waits when nothing depends on the answer.",
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
    svc.target_chat(&input.chat_id, &caller.project_id).await?;
    let until = input
        .until
        .unwrap_or_else(|| vec![Until::Idle, Until::WaitingForPermission, Until::Ended]);
    let _slot = ctx.caller.try_begin_wait().ok_or_else(|| {
        ToolError::new(
            ErrorCode::RateLimited,
            "Too many concurrent waits for this chat.",
        )
    })?;
    let requested = Duration::from_millis(input.timeout_ms.unwrap_or(DEFAULT_WAIT_MS));
    let capped = requested.min(Duration::from_millis(MAX_SINGLE_WAIT_MS));
    let watched = [input.chat_id.clone()];
    let probe = || async {
        let chat = svc.port.chat(&input.chat_id).await?;
        let state = svc.state_of(&chat);
        until
            .iter()
            .any(|u| u.matches(state))
            .then_some((chat, state))
    };
    match wait_for(svc, ctx, capped, &watched, probe).await {
        WaitEnd::Matched((chat, state)) => Ok(result(svc, &chat, state, true, false).await),
        WaitEnd::TimedOut => {
            let chat = svc.target_chat(&input.chat_id, &caller.project_id).await?;
            // Only a genuine exhaustion of the caller's own requested budget
            // is a final `waitTimedOut`; hitting our own safety cap first is
            // reported as `stillWaiting` so the agent knows to call again.
            let still_waiting = capped < requested;
            Ok(result(svc, &chat, svc.state_of(&chat), false, still_waiting).await)
        }
        WaitEnd::Cancelled => Err(ToolError::new(
            ErrorCode::CallerNotActive,
            "The wait was cancelled because the calling turn stopped.",
        )),
    }
}

async fn result(
    svc: &OrchestrationService,
    chat: &ChatView,
    state: ChatState,
    matched: bool,
    still_waiting: bool,
) -> Value {
    let text = last_assistant_text(&svc.port.messages(&chat.id).await);
    json!({
        "chatId": chat.id,
        "state": state,
        "matched": if matched { json!(state) } else { Value::Null },
        "waitTimedOut": !matched && !still_waiting,
        "stillWaiting": still_waiting,
        "lastAssistantText": if text.is_empty() { Value::Null } else { json!(cap_chars(&text, LAST_TEXT_CAP)) },
        "pendingPermission": chat.pending_permission.as_ref()
            .map(|p| json!({ "toolName": p.tool_name, "summary": p.summary })),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::input::golden::{fixture_keys, schema_properties};
    use crate::ports::PendingPermissionView;
    use crate::test_support::{FakePort, service_with};

    #[test]
    fn schema_matches_the_input_struct() {
        let accept = json!({ "chatId": "c", "until": ["idle"], "timeoutMs": 1000 });
        assert_eq!(
            schema_properties(&definition().input_schema),
            fixture_keys(&accept)
        );
        assert!(parse_args::<Input>(accept).is_ok());
        assert!(parse_args::<Input>(json!({ "chatId": "c", "until": [] })).is_err());
        assert!(parse_args::<Input>(json!({ "chatId": "c", "until": ["busy"] })).is_err());
        assert!(parse_args::<Input>(json!({ "chatId": "c", "timeoutMs": 5 })).is_err());
    }

    fn setup() -> (std::sync::Arc<OrchestrationService>, CallCtx, FakePort) {
        let port = FakePort::new();
        port.add_chat("caller");
        let mut target = port.add_chat("target");
        target.working = true;
        port.put(target);
        let (svc, ctx) = service_with(port.clone(), "caller");
        (svc, ctx, port)
    }

    #[tokio::test(start_paused = true)]
    async fn returns_on_the_event_without_polling() {
        let (svc, ctx, port) = setup();
        let waiter = {
            let svc = svc.clone();
            tokio::spawn(async move { run(&svc, &ctx, json!({ "chatId": "target" })).await })
        };
        tokio::task::yield_now().await;
        port.update("target", |c| c.working = false);
        port.touch("target");
        let out = waiter.await.unwrap().unwrap();
        assert_eq!(out["matched"], "idle");
        assert_eq!(out["waitTimedOut"], false);
    }

    #[tokio::test(start_paused = true)]
    async fn returns_on_a_permission_gate_and_times_out_without_side_effects() {
        let (svc, ctx, port) = setup();
        let out = run(&svc, &ctx, json!({ "chatId": "target", "timeoutMs": 1000 }))
            .await
            .unwrap();
        assert_eq!(out["waitTimedOut"], true);
        assert_eq!(out["state"], "working");
        assert!(port.lock().interrupted.is_empty());

        port.update("target", |c| {
            c.pending_permission = Some(PendingPermissionView {
                tool_name: "Bash".into(),
                summary: "rm".into(),
            });
        });
        let out = run(&svc, &ctx, json!({ "chatId": "target" }))
            .await
            .unwrap();
        assert_eq!(out["matched"], "waiting_for_permission");
        assert_eq!(out["pendingPermission"]["toolName"], "Bash");
    }

    #[tokio::test]
    async fn a_chat_may_not_wait_on_itself() {
        let (svc, ctx, _port) = setup();
        let err = run(&svc, &ctx, json!({ "chatId": "caller" }))
            .await
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidRequest);
    }

    /// A request above the internal safety cap never actually holds the
    /// call open for the full requested duration: it returns `stillWaiting`
    /// once the cap elapses, not a final `waitTimedOut`.
    #[tokio::test(start_paused = true)]
    async fn a_request_above_the_safety_cap_returns_still_waiting_at_the_cap() {
        let (svc, ctx, _port) = setup();
        let start = tokio::time::Instant::now();
        let out = run(
            &svc,
            &ctx,
            json!({ "chatId": "target", "timeoutMs": MAX_SINGLE_WAIT_MS * 10 }),
        )
        .await
        .unwrap();
        assert_eq!(out["waitTimedOut"], false);
        assert_eq!(out["stillWaiting"], true);
        assert_eq!(start.elapsed(), Duration::from_millis(MAX_SINGLE_WAIT_MS));
    }

    /// A request at or under the cap behaves exactly as before: a real
    /// timeout at the caller's own requested duration.
    #[tokio::test(start_paused = true)]
    async fn a_request_under_the_safety_cap_still_times_out_for_real() {
        let (svc, ctx, _port) = setup();
        let out = run(&svc, &ctx, json!({ "chatId": "target", "timeoutMs": 1000 }))
            .await
            .unwrap();
        assert_eq!(out["waitTimedOut"], true);
        assert_eq!(out["stillWaiting"], false);
    }
}
