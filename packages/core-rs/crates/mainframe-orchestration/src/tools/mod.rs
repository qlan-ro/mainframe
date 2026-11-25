//! The tool catalogue. Each tool module owns its definition (what the model
//! sees), its input struct, and its handler.

use serde_json::{Value, json};

use crate::calls::CallCtx;
use crate::errors::ToolError;
use crate::ports::ChatView;
use crate::service::OrchestrationService;
use crate::state::ChatState;

mod capabilities;
mod chat_interrupt;
mod chat_launch;
mod chat_list;
mod chat_read;
pub mod chat_read_items;
mod chat_send;
mod chat_wait;
mod delegate_task;
mod launch_common;
mod task_status;

/// What `tools/list` says about one tool.
struct ToolDef {
    title: &'static str,
    description: &'static str,
    input_schema: Value,
    read_only: bool,
    destructive: bool,
    idempotent: bool,
}

impl ToolDef {
    fn to_json(&self, name: &str) -> Value {
        json!({
            "name": name,
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

/// The catalogue, in `tools/list` order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Tool {
    Capabilities,
    ChatList,
    ChatRead,
    ChatWait,
    ChatLaunch,
    ChatSend,
    ChatInterrupt,
    DelegateTask,
    TaskStatus,
    TaskCancel,
}

impl Tool {
    const ALL: [Self; 10] = [
        Self::Capabilities,
        Self::ChatList,
        Self::ChatRead,
        Self::ChatWait,
        Self::ChatLaunch,
        Self::ChatSend,
        Self::ChatInterrupt,
        Self::DelegateTask,
        Self::TaskStatus,
        Self::TaskCancel,
    ];

    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Capabilities => "capabilities",
            Self::ChatList => "chat_list",
            Self::ChatRead => "chat_read",
            Self::ChatWait => "chat_wait",
            Self::ChatLaunch => "chat_launch",
            Self::ChatSend => "chat_send",
            Self::ChatInterrupt => "chat_interrupt",
            Self::DelegateTask => "delegate_task",
            Self::TaskStatus => "task_status",
            Self::TaskCancel => "task_cancel",
        }
    }

    pub(crate) fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|tool| tool.name() == name)
    }

    fn definition(self) -> ToolDef {
        match self {
            Self::Capabilities => capabilities::definition(),
            Self::ChatList => chat_list::definition(),
            Self::ChatRead => chat_read::definition(),
            Self::ChatWait => chat_wait::definition(),
            Self::ChatLaunch => chat_launch::definition(),
            Self::ChatSend => chat_send::definition(),
            Self::ChatInterrupt => chat_interrupt::definition(),
            Self::DelegateTask => delegate_task::definition(),
            Self::TaskStatus => task_status::status_definition(),
            Self::TaskCancel => task_status::cancel_definition(),
        }
    }

    pub(crate) async fn run(
        self,
        svc: &OrchestrationService,
        ctx: &CallCtx,
        args: Value,
    ) -> Result<Value, ToolError> {
        match self {
            Self::Capabilities => capabilities::run(svc, ctx, args).await,
            Self::ChatList => chat_list::run(svc, ctx, args).await,
            Self::ChatRead => chat_read::run(svc, ctx, args).await,
            Self::ChatWait => chat_wait::run(svc, ctx, args).await,
            Self::ChatLaunch => chat_launch::run(svc, ctx, args).await,
            Self::ChatSend => chat_send::run(svc, ctx, args).await,
            Self::ChatInterrupt => chat_interrupt::run(svc, ctx, args).await,
            Self::DelegateTask => delegate_task::run(svc, ctx, args).await,
            Self::TaskStatus => task_status::run_status(svc, ctx, args).await,
            Self::TaskCancel => task_status::run_cancel(svc, ctx, args).await,
        }
    }
}

#[must_use]
pub(crate) fn list() -> Vec<Value> {
    Tool::ALL
        .into_iter()
        .map(|tool| tool.definition().to_json(tool.name()))
        .collect()
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
    fn every_name_resolves_to_its_own_tool() {
        for tool in Tool::ALL {
            assert_eq!(Tool::from_name(tool.name()), Some(tool));
        }
        assert_eq!(Tool::from_name("chat_delete"), None);
    }

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
        for tool in Tool::ALL {
            let read = matches!(
                tool,
                Tool::Capabilities
                    | Tool::ChatList
                    | Tool::ChatRead
                    | Tool::ChatWait
                    | Tool::TaskStatus
            );
            assert_eq!(tool.definition().read_only, read, "{}", tool.name());
        }
    }
}
