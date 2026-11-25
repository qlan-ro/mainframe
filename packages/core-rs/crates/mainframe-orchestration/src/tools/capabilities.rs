//! `capabilities`: who the caller is, what it may start, and the limits.

use serde::Deserialize;
use serde_json::{Map, Value, json};

use mainframe_types::settings::{EXECUTION_MODES, ExecutionMode};

use super::ToolDef;
use crate::calls::CallCtx;
use crate::errors::ToolError;
use crate::input::{Validate, object_schema, parse_args};
use crate::policy::{
    DEFAULT_WAIT_MS, MAX_ACTIVE_TASKS_PER_TREE, MAX_DEPTH, MAX_SINGLE_WAIT_MS, MAX_WAIT_MS,
    READ_MAX_CHARS, READ_MAX_ITEMS, effective_mode_rank, mode_label_supported, mode_meaning,
};
use crate::ports::AdapterView;
use crate::service::OrchestrationService;

pub(super) fn definition() -> ToolDef {
    ToolDef {
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
    let depth = svc.depth_of(&caller).await?;
    let adapters = svc.port.adapters().await;
    // Keyed by adapter, not one flat list: the ceiling compares *effective*
    // privilege (`policy::effective_mode_rank`), which a mode's label does not
    // carry across providers.
    let caller_rank = effective_mode_rank(&caller.adapter_id, caller.permission_mode);
    let mut allowed_modes = Map::new();
    let mut mode_meanings = Map::new();
    for adapter in &adapters {
        let allowed = allowed_modes_on(adapter, caller_rank);
        let meanings: Map<_, _> = allowed
            .iter()
            .map(|mode| {
                (
                    mode.as_str().to_string(),
                    json!(mode_meaning(&adapter.id, *mode)),
                )
            })
            .collect();
        allowed_modes.insert(adapter.id.clone(), json!(allowed));
        mode_meanings.insert(adapter.id.clone(), meanings.into());
    }
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
        "allowedPermissionModes": allowed_modes,
        "permissionModeMeanings": mode_meanings,
        "limits": {
            "maxDepth": MAX_DEPTH,
            "maxActiveTasksPerTree": MAX_ACTIVE_TASKS_PER_TREE,
            "activeTasksInTree": svc.open_tasks_in_tree(&caller.id).await?,
            "launchesRemaining": svc.limiter.remaining(&caller.id),
            "defaultWaitMs": DEFAULT_WAIT_MS,
            "maxWaitMs": MAX_WAIT_MS,
            "maxSingleWaitMs": MAX_SINGLE_WAIT_MS,
            "readMaxItems": READ_MAX_ITEMS,
            "readMaxChars": READ_MAX_CHARS,
        },
    }))
}

/// The modes a caller ranked `caller_rank` may give a chat on `adapter`.
fn allowed_modes_on(adapter: &AdapterView, caller_rank: u8) -> Vec<ExecutionMode> {
    EXECUTION_MODES
        .into_iter()
        .filter(|mode| mode_label_supported(*mode, adapter.auto_mode))
        .filter(|mode| effective_mode_rank(&adapter.id, *mode) <= caller_rank)
        .collect()
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
#[path = "capabilities_tests.rs"]
mod tests;
