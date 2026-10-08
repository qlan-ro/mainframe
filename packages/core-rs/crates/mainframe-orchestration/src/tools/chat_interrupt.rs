//! `chat_interrupt`: stop a chat's active turn and everything it delegated.

use serde::Deserialize;
use serde_json::{Value, json};

use super::ToolDef;
use crate::errors::{ErrorCode, ToolError};
use crate::input::{
    Validate, check_id, check_opt_len, id_schema, object_schema, parse_args, string_schema,
};
use crate::policy::{REASON_MAX, check_ceiling};
use crate::service::{CallCtx, OrchestrationService};
use crate::state::ChatState;

pub(super) fn definition() -> ToolDef {
    ToolDef {
        name: "chat_interrupt",
        title: "Interrupt a Mainframe chat",
        description: "Stop a chat's active turn. Its delegated tasks are cancelled first, deepest \
            first, and messages Mainframe was holding for it are dropped. The chat itself is \
            kept and can be continued. Returns no_active_turn when the chat is idle.",
        input_schema: object_schema(
            json!({
                "chatId": id_schema("The chat to interrupt."),
                "reason": string_schema(REASON_MAX, "Why, recorded on cancelled tasks.")
            }),
            &["chatId"],
        ),
        read_only: false,
        destructive: true,
        idempotent: false,
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Input {
    chat_id: String,
    reason: Option<String>,
}

impl Validate for Input {
    fn validate(&self) -> Result<(), ToolError> {
        check_id("chatId", &self.chat_id)?;
        check_opt_len("reason", self.reason.as_deref(), REASON_MAX)
    }
}

pub(super) async fn run(
    svc: &OrchestrationService,
    ctx: &CallCtx,
    args: Value,
) -> Result<Value, ToolError> {
    let input: Input = parse_args(args)?;
    let caller = svc.active_caller(ctx).await?;
    let target = svc.target_chat(&input.chat_id, &caller).await?;
    check_ceiling(&caller.privileges(), &target.privileges())?;
    if !matches!(
        svc.state_of(&target),
        ChatState::Working | ChatState::WaitingForPermission
    ) {
        return Err(ToolError::new(
            ErrorCode::NoActiveTurn,
            "The chat has no active turn to interrupt.",
        ));
    }
    let cancelled = svc.cascade_stop(&target.id, input.reason.as_deref()).await;
    svc.port.interrupt(&target.id).await;
    let after = svc.port.chat(&target.id).await.unwrap_or(target);
    Ok(json!({
        "chatId": after.id,
        "interrupted": true,
        "state": svc.state_of(&after),
        "cancelledTaskIds": cancelled,
    }))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::input::golden::{fixture_keys, schema_properties};
    use crate::outbox::OutboxKind;
    use crate::test_support::{FakePort, service_with};

    #[test]
    fn schema_matches_the_input_struct() {
        let accept = json!({ "chatId": "c", "reason": "done" });
        assert_eq!(
            schema_properties(&definition().input_schema),
            fixture_keys(&accept)
        );
        assert!(parse_args::<Input>(accept).is_ok());
        assert!(parse_args::<Input>(json!({ "chatId": "c", "reason": "x".repeat(501) })).is_err());
    }

    #[tokio::test]
    async fn interrupts_a_busy_chat_and_drops_what_was_held_for_it() {
        let port = FakePort::new();
        for id in ["caller", "target"] {
            let mut chat = port.add_chat(id);
            chat.working = true;
            port.put(chat);
        }
        let (svc, ctx) = service_with(port.clone(), "caller");
        svc.outbox
            .push("target", "caller", OutboxKind::Send, "x".into(), "x");
        let out = run(&svc, &ctx, json!({ "chatId": "target" }))
            .await
            .unwrap();
        assert_eq!(out["interrupted"], true);
        assert_eq!(port.lock().interrupted, vec!["target".to_string()]);
        assert!(!svc.outbox.has_for("target"));
        let err = run(&svc, &ctx, json!({ "chatId": "target" }))
            .await
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::NoActiveTurn);
    }

    #[tokio::test]
    async fn a_chat_in_another_project_reads_as_not_found() {
        let port = FakePort::new();
        let mut caller = port.add_chat("caller");
        caller.working = true;
        port.put(caller);
        let mut target = port.add_chat("target");
        target.working = true;
        target.project_id = "other-project".into();
        port.put(target);
        let (svc, ctx) = service_with(port.clone(), "caller");
        let err = run(&svc, &ctx, json!({ "chatId": "target" }))
            .await
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::ChatNotFound);
    }

    /// A chat the caller `chat_launch`ed into another project stays
    /// interruptible: lineage keeps it in scope even though its project
    /// differs from the caller's.
    #[tokio::test]
    async fn a_chat_the_caller_launched_into_another_project_is_still_interruptible() {
        let port = FakePort::new();
        let mut caller = port.add_chat("caller");
        caller.working = true;
        port.put(caller);
        let mut target = port.add_chat("target");
        target.working = true;
        target.project_id = "other-project".into();
        target.created_by_chat_id = Some("caller".into());
        port.put(target);
        let (svc, ctx) = service_with(port.clone(), "caller");
        let out = run(&svc, &ctx, json!({ "chatId": "target" }))
            .await
            .unwrap();
        assert_eq!(out["interrupted"], true);
    }
}
