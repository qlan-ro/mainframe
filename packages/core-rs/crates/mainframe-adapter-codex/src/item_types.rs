//! `ThreadItem` union. INTERNAL to this crate (crate-map §2.8 `types.ts` note) —
//! deserializes from Codex app-server JSON-RPC payloads, so variant tags track
//! Codex's camelCase and unknown fields are tolerated (serde ignores them).
//! Payload structs live in `thread_item_variants` (moved out to keep this file
//! under the 300-line ceiling); re-exported here so existing `item_types::X` call
//! sites keep compiling unchanged.

pub use crate::thread_item_variants::*;
pub use crate::web_search_action::{WebSearchAction, WebSearchItem};

/// `ThreadItem` — the tagged union of every item type Codex streams. Statuses stay
/// `String` (not enums) to mirror the TS string-literal comparisons and tolerate
/// unknown Codex status values without failing the whole item.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ThreadItem {
    AgentMessage(AgentMessageItem),
    Reasoning(ReasoningItem),
    CommandExecution(CommandExecutionItem),
    FileChange(FileChangeItem),
    McpToolCall(McpToolCallItem),
    WebSearch(WebSearchItem),
    ImageGeneration(ImageGenerationItem),
    TodoList(TodoListItem),
    UserMessage(UserMessageItem),
    CollabAgentToolCall(CollabAgentToolCallItem),
    ContextCompaction(ContextCompactionItem),
    SubAgentActivity(SubAgentActivityItem),
    DynamicToolCall(DynamicToolCallItem),
    EnteredReviewMode(EnteredReviewModeItem),
    ExitedReviewMode(ExitedReviewModeItem),
    ImageView(ImageViewItem),
    Sleep(SleepItem),
    HookPrompt(HookPromptItem),
}
