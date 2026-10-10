//! `capabilities`: who the caller is, what it may start, and the limits.

use serde::Deserialize;
use serde_json::{Value, json};

use mainframe_types::settings::{EXECUTION_MODES, ExecutionMode};

use super::ToolDef;
use crate::errors::ToolError;
use crate::input::{Validate, object_schema, parse_args};
use crate::policy::{
    DEFAULT_WAIT_MS, MAX_ACTIVE_TASKS_PER_TREE, MAX_DEPTH, MAX_SINGLE_WAIT_MS, MAX_WAIT_MS,
    READ_MAX_CHARS, READ_MAX_ITEMS, effective_mode_rank, mode_label_supported, mode_meaning,
};
use crate::ports::AdapterView;
use crate::service::{CallCtx, OrchestrationService};

pub(super) fn definition() -> ToolDef {
    ToolDef {
        name: "capabilities",
        title: "Mainframe capabilities",
        description: "Describe the calling chat (adapter, model, permission mode, plan mode, \
            orchestration depth), the installed adapters and their models, the permission modes \
            this chat may grant on each adapter, and the orchestration limits. Call this before \
            launching or delegating to pick a valid adapter and model.",
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
    // Per adapter, not one flat list: the ceiling compares *effective*
    // privilege (policy::effective_mode_rank), which a mode's label does
    // not carry across providers (Codex has no rank-0 "ask before every
    // edit" mode, so its `default`/`acceptEdits`/`auto` share one allowed-
    // or-not answer that can differ from Claude's for the same caller).
    let caller_rank = effective_mode_rank(&caller.adapter_id, caller.permission_mode);
    let allowed_modes_by_adapter: Vec<(String, Vec<ExecutionMode>)> = adapters
        .iter()
        .map(|a| {
            let allowed: Vec<_> = EXECUTION_MODES
                .into_iter()
                .filter(|m| mode_label_supported(*m, a.auto_mode))
                .filter(|m| effective_mode_rank(&a.id, *m) <= caller_rank)
                .collect();
            (a.id.clone(), allowed)
        })
        .collect();
    let allowed_by_adapter: Value = allowed_modes_by_adapter
        .iter()
        .map(|(id, allowed)| (id.clone(), json!(allowed)))
        .collect::<serde_json::Map<_, _>>()
        .into();
    // One-line meaning per allowed mode, per adapter — cheap (a static
    // string table, not a live probe) and the reason a caller might reach
    // for a mode other than "inherit": e.g. Codex `default` really does ask
    // before writes and network now, where before it silently
    // edited unprompted.
    let permission_mode_meanings: Value = allowed_modes_by_adapter
        .iter()
        .map(|(id, allowed)| {
            let meanings: serde_json::Map<String, Value> = allowed
                .iter()
                .map(|m| (mode_label(*m), json!(mode_meaning(id, *m))))
                .collect();
            (id.clone(), Value::Object(meanings))
        })
        .collect::<serde_json::Map<_, _>>()
        .into();
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
        "allowedPermissionModes": allowed_by_adapter,
        "permissionModeMeanings": permission_mode_meanings,
        "limits": {
            "maxDepth": MAX_DEPTH,
            "maxActiveTasksPerTree": MAX_ACTIVE_TASKS_PER_TREE,
            "activeTasksInTree": svc.open_tasks_in_tree(&caller.id).await,
            "launchesRemaining": svc.limiter.remaining(&caller.id),
            "defaultWaitMs": DEFAULT_WAIT_MS,
            "maxWaitMs": MAX_WAIT_MS,
            "maxSingleWaitMs": MAX_SINGLE_WAIT_MS,
            "readMaxItems": READ_MAX_ITEMS,
            "readMaxChars": READ_MAX_CHARS,
        },
    }))
}

/// `ExecutionMode`'s own camelCase wire label, for use as a JSON object key
/// (`json!` can only serialize an `ExecutionMode` as a value, not a key).
fn mode_label(mode: ExecutionMode) -> String {
    match serde_json::to_value(mode) {
        Ok(Value::String(s)) => s,
        other => unreachable!("ExecutionMode always serializes to a string, got {other:?}"),
    }
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
            out["allowedPermissionModes"]["claude"],
            json!(["default", "acceptEdits"])
        );
        assert_eq!(out["adapters"][0]["id"], "claude");
        assert_eq!(out["limits"]["launchesRemaining"], 20);
        assert_eq!(out["limits"]["maxSingleWaitMs"], MAX_SINGLE_WAIT_MS);
        // One meaning per allowed mode, keyed the same way as
        // `allowedPermissionModes`, and non-empty.
        assert_eq!(
            out["permissionModeMeanings"]["claude"]
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<std::collections::HashSet<_>>(),
            ["default", "acceptEdits"]
                .into_iter()
                .map(String::from)
                .collect::<std::collections::HashSet<_>>()
        );
        assert!(
            !out["permissionModeMeanings"]["claude"]["default"]
                .as_str()
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn allowed_permission_modes_are_per_adapter_not_one_flat_list() {
        // A Codex caller in `acceptEdits` (effective rank 1, same as
        // `default` on Codex) must see `default` and `acceptEdits` allowed
        // on Codex, but never `auto` — Codex has no distinct auto mode
        // (`auto_mode: false`) even though its effective rank for `auto`
        // happens to match — and only up through Claude's own rank-1 mode
        // on Claude.
        let port = FakePort::new();
        port.lock().adapters.push(crate::ports::AdapterView {
            id: "codex".into(),
            name: "Codex".into(),
            installed: true,
            available: true,
            unavailable_reason: None,
            models: vec![],
            steer: false,
            auto_mode: false,
        });
        let mut caller = port.add_chat("caller");
        caller.adapter_id = "codex".into();
        caller.permission_mode = ExecutionMode::AcceptEdits;
        port.put(caller);
        let (svc, ctx) = service_with(port, "caller");
        let out = run(&svc, &ctx, json!({})).await.unwrap();
        assert_eq!(
            out["allowedPermissionModes"]["codex"],
            json!(["default", "acceptEdits"])
        );
        assert_eq!(
            out["allowedPermissionModes"]["claude"],
            json!(["default", "acceptEdits"])
        );
    }
}
