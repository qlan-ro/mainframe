//! `chat_list`: a project's agent-addressable chats, newest first, paged.

use mainframe_types::chat::ChatStatus;
use serde::Deserialize;
use serde_json::{Value, json};

use super::launch_common::resolve_project;
use super::{ToolDef, chat_summary};
use crate::calls::CallCtx;
use crate::errors::ToolError;
use crate::input::{
    Validate, check_opt_id, check_opt_len, check_range, id_schema, object_schema, parse_args,
    string_schema,
};
use crate::policy::{RESULT_BUDGET_BYTES, TITLE_MAX};
use crate::ports::ChatView;
use crate::service::OrchestrationService;

const DEFAULT_LIMIT: u64 = 50;
const MAX_LIMIT: u64 = 100;

pub(super) fn definition() -> ToolDef {
    ToolDef {
        title: "List Mainframe chats",
        description: "List chats in a project (default: the caller's), most recently updated \
            first. Side chats, temporary chats, and automation chats are never listed. Use this \
            to find a chat id, or to check whether a launch whose result was lost created a chat \
            before retrying it.",
        input_schema: object_schema(
            json!({
                "projectId": id_schema("Project id, or \"no-project\". Default: the caller's."),
                "status": { "enum": ["active", "archived", "all"], "description": "Default active." },
                "titleContains": string_schema(TITLE_MAX, "Case-insensitive title filter."),
                "includeDelegated": { "type": "boolean", "description": "Default true." },
                "limit": { "type": "integer", "minimum": 1, "maximum": MAX_LIMIT },
                "offset": { "type": "integer", "minimum": 0 }
            }),
            &[],
        ),
        read_only: true,
        destructive: false,
        idempotent: true,
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum StatusFilter {
    #[default]
    Active,
    Archived,
    All,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Input {
    project_id: Option<String>,
    #[serde(default)]
    status: StatusFilter,
    title_contains: Option<String>,
    include_delegated: Option<bool>,
    limit: Option<u64>,
    offset: Option<u64>,
}

impl Validate for Input {
    fn validate(&self) -> Result<(), ToolError> {
        check_opt_id("projectId", self.project_id.as_deref())?;
        check_opt_len("titleContains", self.title_contains.as_deref(), TITLE_MAX)?;
        if let Some(limit) = self.limit {
            check_range("limit", limit, 1, MAX_LIMIT)?;
        }
        Ok(())
    }
}

pub(super) async fn run(
    svc: &OrchestrationService,
    ctx: &CallCtx,
    args: Value,
) -> Result<Value, ToolError> {
    let input: Input = parse_args(args)?;
    let caller = svc.caller_chat(ctx).await?;
    let project_id = resolve_project(svc, input.project_id.as_deref(), &caller).await?;
    let include_archived = input.status != StatusFilter::Active;
    let title_needle = input.title_contains.as_deref().map(str::to_lowercase);
    let mut chats: Vec<ChatView> = svc
        .port
        .list_chats(&project_id, include_archived)
        .await?
        .into_iter()
        .filter(|c| input.keeps(c, title_needle.as_deref()))
        .collect();
    chats.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(b.id.cmp(&a.id)));
    Ok(page(svc, &project_id, &chats, &input))
}

impl Input {
    fn keeps(&self, chat: &ChatView, title_needle: Option<&str>) -> bool {
        let status_ok = match self.status {
            StatusFilter::Active => chat.status != ChatStatus::Archived,
            StatusFilter::Archived => chat.status == ChatStatus::Archived,
            StatusFilter::All => true,
        };
        let title_ok = title_needle.is_none_or(|needle| {
            let title = chat.title.as_deref().unwrap_or_default();
            title.to_lowercase().contains(needle)
        });
        let lineage_ok = self.include_delegated.unwrap_or(true) || chat.task_id.is_none();
        chat.is_agent_addressable() && status_ok && title_ok && lineage_ok
    }
}

/// One page of summaries, cut short when the result budget runs out.
fn page(svc: &OrchestrationService, project_id: &str, chats: &[ChatView], input: &Input) -> Value {
    let total = chats.len();
    let offset = usize::try_from(input.offset.unwrap_or(0)).unwrap_or(usize::MAX);
    let limit = usize::try_from(input.limit.unwrap_or(DEFAULT_LIMIT)).unwrap_or(usize::MAX);
    let mut summaries = Vec::new();
    let mut used = 0;
    for chat in chats.iter().skip(offset).take(limit) {
        let summary = chat_summary(chat, svc.state_of(chat));
        used += summary.to_string().len() + 1;
        if used > RESULT_BUDGET_BYTES - 512 && !summaries.is_empty() {
            break;
        }
        summaries.push(summary);
    }
    let next = offset + summaries.len();
    json!({
        "projectId": project_id,
        "chats": summaries,
        "total": total,
        "nextOffset": if next < total { json!(next) } else { Value::Null },
    })
}

#[cfg(test)]
#[path = "chat_list_tests.rs"]
mod tests;
