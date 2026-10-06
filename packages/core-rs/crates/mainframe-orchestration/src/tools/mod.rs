//! The tool catalogue. Each tool module owns its definition (what the model
//! sees), its input struct, and its handler.

use serde_json::{Value, json};

use crate::errors::ToolError;
use crate::ports::ChatView;
use crate::service::{CallCtx, OrchestrationService};
use crate::state::ChatState;

mod capabilities;
mod chat_interrupt;
mod chat_launch;
mod chat_list;
mod chat_read;
mod chat_read_items;
mod chat_send;
mod chat_wait;
mod delegate_task;
mod launch_common;
mod task_status;

/// One `tools/list` entry.
pub struct ToolDef {
    pub name: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
    pub read_only: bool,
    pub destructive: bool,
    pub idempotent: bool,
}

impl ToolDef {
    fn to_json(&self) -> Value {
        json!({
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "inputSchema": self.input_schema,
            "annotations": {
                "title": self.title,
                "readOnlyHint": self.read_only,
                "destructiveHint": self.destructive,
                "idempotentHint": self.idempotent,
                "openWorldHint": false,
            },
        })
    }
}

#[must_use]
pub fn definitions() -> Vec<ToolDef> {
    vec![
        capabilities::definition(),
        chat_list::definition(),
        chat_read::definition(),
        chat_wait::definition(),
        chat_launch::definition(),
        chat_send::definition(),
        chat_interrupt::definition(),
        delegate_task::definition(),
        task_status::status_definition(),
        task_status::cancel_definition(),
    ]
}

#[must_use]
pub fn list() -> Vec<Value> {
    definitions().iter().map(ToolDef::to_json).collect()
}

#[must_use]
pub fn exists(name: &str) -> bool {
    definitions().iter().any(|d| d.name == name)
}

pub(crate) async fn call(
    svc: &OrchestrationService,
    ctx: &CallCtx,
    name: &str,
    args: Value,
) -> Result<Value, ToolError> {
    match name {
        "capabilities" => capabilities::run(svc, ctx, args).await,
        "chat_list" => chat_list::run(svc, ctx, args).await,
        "chat_read" => chat_read::run(svc, args).await,
        "chat_wait" => chat_wait::run(svc, ctx, args).await,
        "chat_launch" => chat_launch::run(svc, ctx, args).await,
        "chat_send" => chat_send::run(svc, ctx, args).await,
        "chat_interrupt" => chat_interrupt::run(svc, ctx, args).await,
        "delegate_task" => delegate_task::run(svc, ctx, args).await,
        "task_status" => task_status::run_status(svc, ctx, args).await,
        "task_cancel" => task_status::run_cancel(svc, ctx, args).await,
        _ => Err(ToolError::invalid(format!("Unknown tool: {name}"))),
    }
}

/// One derivation for every reader: a task row makes a child `delegated`, a
/// temporary child is a side chat (never listed), any other child a `fork`.
fn lineage(chat: &ChatView) -> Value {
    match (&chat.task_id, &chat.parent_chat_id, chat.temporary) {
        (Some(_), _, _) => json!("delegated"),
        (None, Some(_), false) => json!("fork"),
        _ => Value::Null,
    }
}

/// The `ChatSummary` shape shared by `chat_list` and `chat_launch`.
pub(crate) fn chat_summary(chat: &ChatView, state: ChatState) -> Value {
    json!({
        "chatId": chat.id,
        "projectId": chat.project_id,
        "title": chat.title,
        "adapterId": chat.adapter_id,
        "model": chat.model,
        "permissionMode": chat.permission_mode,
        "planMode": chat.plan_mode,
        "state": state,
        "parentChatId": chat.parent_chat_id,
        "lineage": lineage(chat),
        "createdByChatId": chat.created_by_chat_id,
        "taskId": chat.task_id,
        "worktreePath": chat.worktree_path,
        "branchName": chat.branch_name,
        "createdAt": chat.created_at,
        "updatedAt": chat.updated_at,
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn every_tool_is_listed_once_with_closed_schemas_and_annotations() {
        let tools = list();
        let names: HashSet<_> = tools.iter().map(|t| t["name"].as_str()).collect();
        assert_eq!(names.len(), tools.len());
        for tool in &tools {
            assert_eq!(tool["inputSchema"]["type"], "object");
            assert_eq!(tool["inputSchema"]["additionalProperties"], false);
            assert_eq!(tool["annotations"]["openWorldHint"], false);
            assert!(tool.get("outputSchema").is_none());
            assert!(tool["description"].as_str().is_some_and(|d| !d.is_empty()));
        }
    }

    #[test]
    fn read_tools_are_marked_read_only() {
        for def in definitions() {
            let read = matches!(
                def.name,
                "capabilities" | "chat_list" | "chat_read" | "chat_wait" | "task_status"
            );
            assert_eq!(def.read_only, read, "{}", def.name);
        }
    }
}
