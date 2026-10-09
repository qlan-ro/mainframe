//! `chat_launch`: create an ordinary top-level chat, optionally with a first
//! prompt. The chat records the caller as `created_by_chat_id` but has no
//! lineage: it is not a fork and not a task.

use mainframe_types::settings::ExecutionMode;
use serde::Deserialize;
use serde_json::{Value, json};

use super::ToolDef;
use super::launch_common::{
    admit_creation, resolve_adapter, resolve_privileges, resolve_project, resolve_workspace,
};
use crate::errors::ToolError;
use crate::input::{
    Validate, WorkspaceInput, WorkspaceMode, check_opt_id, check_opt_len, check_text, id_schema,
    object_schema, parse_args, permission_mode_schema, string_schema, text_schema,
    workspace_schema,
};
use crate::policy::TITLE_MAX;
use crate::ports::{ChatView, LaunchRequest};
use crate::service::{CallCtx, OrchestrationService};
use crate::state::{AgentMessageKind, wrap_agent_message};

pub(super) fn definition() -> ToolDef {
    ToolDef {
        name: "chat_launch",
        title: "Launch a Mainframe chat",
        description: "Create a new top-level chat the user can open, optionally sending it a \
            first prompt. Defaults: the caller's project, adapter, model, permission mode, and \
            plan mode; workspace project_root. Overrides may only narrow privileges. There is \
            no retry key: if a launch result is lost, call chat_list before launching again.",
        input_schema: object_schema(
            json!({
                "projectId": id_schema("Project id, or \"no-project\". Default: the caller's."),
                "prompt": text_schema("Optional first message."),
                "title": string_schema(TITLE_MAX, "Chat title."),
                "adapterId": id_schema("Adapter id from capabilities."),
                "model": string_schema(200, "Model id from capabilities."),
                "permissionMode": permission_mode_schema(),
                "planMode": { "type": "boolean" },
                "workspace": workspace_schema(
                    &["inherit", "project_root", "new_worktree", "existing_worktree"],
                    "Where the chat runs. inherit is allowed only within the caller's project."
                )
            }),
            &[],
        ),
        read_only: false,
        destructive: false,
        idempotent: false,
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Input {
    project_id: Option<String>,
    prompt: Option<String>,
    title: Option<String>,
    adapter_id: Option<String>,
    model: Option<String>,
    permission_mode: Option<ExecutionMode>,
    plan_mode: Option<bool>,
    workspace: Option<WorkspaceInput>,
}

impl Validate for Input {
    fn validate(&self) -> Result<(), ToolError> {
        check_opt_id("projectId", self.project_id.as_deref())?;
        if let Some(prompt) = &self.prompt {
            check_text("prompt", prompt)?;
        }
        check_opt_len("title", self.title.as_deref(), TITLE_MAX)?;
        check_opt_id("adapterId", self.adapter_id.as_deref())?;
        check_opt_len("model", self.model.as_deref(), 200)?;
        self.workspace.as_ref().map_or(Ok(()), Validate::validate)
    }
}

pub(super) async fn run(
    svc: &OrchestrationService,
    ctx: &CallCtx,
    args: Value,
) -> Result<Value, ToolError> {
    let input: Input = parse_args(args)?;
    let caller = svc.active_caller(ctx).await?;
    let request = build_request(svc, &input, &caller).await?;
    admit_creation(svc, &caller).await?;
    let chat = svc.port.launch_chat(request).await?;
    let delivery = deliver_prompt(svc, &caller.id, &chat.id, input.prompt.as_deref()).await?;
    let chat = svc.port.chat(&chat.id).await.unwrap_or(chat);
    Ok(json!({
        "chatId": chat.id,
        "projectId": chat.project_id,
        "adapterId": chat.adapter_id,
        "model": chat.model,
        "permissionMode": chat.permission_mode,
        "planMode": chat.plan_mode,
        "worktreePath": chat.worktree_path,
        "branchName": chat.branch_name,
        "state": svc.state_of(&chat),
        "promptDelivery": delivery,
    }))
}

/// Resolves every default and checks every ceiling before anything is created.
async fn build_request(
    svc: &OrchestrationService,
    input: &Input,
    caller: &ChatView,
) -> Result<LaunchRequest, ToolError> {
    let project_id = resolve_project(svc, input.project_id.as_deref(), caller).await?;
    let (adapter_id, model, adapter_auto_mode) = resolve_adapter(
        svc,
        input.adapter_id.as_deref(),
        input.model.as_deref(),
        caller,
    )
    .await?;
    let privileges = resolve_privileges(
        &adapter_id,
        adapter_auto_mode,
        input.permission_mode,
        input.plan_mode,
        caller,
    )?;
    let workspace = resolve_workspace(
        input.workspace.as_ref(),
        WorkspaceMode::ProjectRoot,
        caller,
        &project_id,
    )?;
    Ok(LaunchRequest {
        project_id,
        adapter_id,
        model,
        permission_mode: privileges.mode,
        plan_mode: privileges.plan,
        title: input.title.clone(),
        workspace,
        created_by_chat_id: caller.id.clone(),
        parent_chat_id: None,
    })
}

async fn deliver_prompt(
    svc: &OrchestrationService,
    caller_id: &str,
    chat_id: &str,
    prompt: Option<&str>,
) -> Result<&'static str, ToolError> {
    let Some(prompt) = prompt else {
        return Ok("none");
    };
    let body = wrap_agent_message(caller_id, AgentMessageKind::Launch, prompt);
    svc.port.send(chat_id, &body).await?;
    Ok("started")
}

#[cfg(test)]
#[path = "chat_launch_tests.rs"]
mod tests;
