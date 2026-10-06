//! `capabilities`: who the caller is, what it may start, and the limits.

use serde::Deserialize;
use serde_json::{Value, json};

use mainframe_types::settings::ExecutionMode;

use super::ToolDef;
use crate::errors::ToolError;
use crate::input::{Validate, object_schema, parse_args};
use crate::policy::{
    DEFAULT_WAIT_MS, MAX_ACTIVE_TASKS_PER_TREE, MAX_DEPTH, MAX_WAIT_MS, READ_MAX_CHARS,
    READ_MAX_ITEMS, mode_rank,
};
use crate::ports::AdapterView;
use crate::service::{CallCtx, OrchestrationService};

pub(super) fn definition() -> ToolDef {
    ToolDef {
        name: "capabilities",
        title: "Mainframe capabilities",
        description: "Describe the calling chat (adapter, model, permission mode, plan mode, \
            orchestration depth), the installed adapters and their models, the permission modes \
            this chat may grant, and the orchestration limits. Call this before launching or \
            delegating to pick a valid adapter and model.",
        input_schema: object_schema(json!({}), &[]),
        read_only: true,
        destructive: false,
        idempotent: true,
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {}

impl Validate for Input {
    fn validate(&self) -> Result<(), ToolError> {
        Ok(())
    }
}

pub(super) async fn run(
    svc: &OrchestrationService,
    ctx: &CallCtx,
    args: Value,
) -> Result<Value, ToolError> {
    let _: Input = parse_args(args)?;
    let caller = svc.caller_chat(ctx).await?;
    let depth = svc.depth_of(&caller).await;
    let adapters = svc.port.adapters().await;
    let allowed: Vec<ExecutionMode> = [
        ExecutionMode::Default,
        ExecutionMode::AcceptEdits,
        ExecutionMode::Auto,
        ExecutionMode::Yolo,
    ]
    .into_iter()
    .filter(|m| mode_rank(*m) <= mode_rank(caller.permission_mode))
    .collect();
    Ok(json!({
        "caller": {
            "chatId": caller.id,
            "projectId": caller.project_id,
            "adapterId": caller.adapter_id,
            "model": caller.model,
            "permissionMode": caller.permission_mode,
            "planMode": caller.plan_mode,
            "depth": depth,
        },
        "adapters": adapters.iter().map(adapter_json).collect::<Vec<_>>(),
        "allowedPermissionModes": allowed,
        "limits": {
            "maxDepth": MAX_DEPTH,
            "maxActiveTasksPerTree": MAX_ACTIVE_TASKS_PER_TREE,
            "activeTasksInTree": svc.open_tasks_in_tree(&caller.id).await,
            "launchesRemaining": svc.limiter.remaining(&caller.id),
            "defaultWaitMs": DEFAULT_WAIT_MS,
            "maxWaitMs": MAX_WAIT_MS,
            "readMaxItems": READ_MAX_ITEMS,
            "readMaxChars": READ_MAX_CHARS,
        },
    }))
}

fn adapter_json(adapter: &AdapterView) -> Value {
    json!({
        "id": adapter.id,
        "name": adapter.name,
        "installed": adapter.installed,
        "available": adapter.available,
        "unavailableReason": adapter.unavailable_reason,
        "models": adapter.models.iter()
            .map(|m| json!({ "id": m.id, "label": m.label }))
            .collect::<Vec<_>>(),
        "steer": adapter.steer,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::input::golden::{fixture_keys, schema_properties};
    use crate::test_support::{FakePort, service_with};

    #[test]
    fn schema_matches_the_input_struct() {
        let def = definition();
        let accept = json!({});
        assert_eq!(schema_properties(&def.input_schema), fixture_keys(&accept));
        assert!(parse_args::<Input>(accept).is_ok());
        assert!(parse_args::<Input>(Value::Null).is_ok());
        assert!(parse_args::<Input>(json!({ "extra": 1 })).is_err());
    }

    #[tokio::test]
    async fn reports_caller_depth_modes_and_adapters() {
        let port = FakePort::new();
        let mut root = port.add_chat("root");
        root.permission_mode = ExecutionMode::AcceptEdits;
        port.put(root);
        let mut child = port.add_chat("child");
        child.created_by_chat_id = Some("root".into());
        child.permission_mode = ExecutionMode::AcceptEdits;
        port.put(child);
        let (svc, ctx) = service_with(port, "child");
        let out = run(&svc, &ctx, json!({})).await.unwrap();
        assert_eq!(out["caller"]["depth"], 1);
        assert_eq!(
            out["allowedPermissionModes"],
            json!(["default", "acceptEdits"])
        );
        assert_eq!(out["adapters"][0]["id"], "claude");
        assert_eq!(out["limits"]["launchesRemaining"], 20);
    }
}
