//! Ported from `packages/core/src/plugins/builtin/codex/item-types.ts`.
//!
//! `ThreadItem` union. INTERNAL to this crate (crate-map §2.8 `types.ts` note) —
//! deserializes from Codex app-server JSON-RPC payloads, so variant tags track
//! Codex's camelCase and unknown fields are tolerated (serde ignores them).
//! Payload structs live in `thread_item_variants` (moved out to keep this file
//! under the 300-line ceiling); re-exported here so existing `item_types::X` call
//! sites keep compiling unchanged.

pub use crate::thread_item_variants::*;

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

// PORT STATUS: src/plugins/builtin/codex/item-types.ts (119 lines)
// confidence: high
// todos: 0
// notes: ThreadItem is internally tagged on "type" with serde camelCase variant
// notes: names (AgentMessage -> "agentMessage", etc.). Item statuses are String
// notes: (not enums) to mirror the TS string-literal comparisons and tolerate
// notes: unknown Codex status values. PatchChangeKind (in thread_item_variants)
// notes: keeps `move_path` snake_case (Codex emits it snake) by NOT applying
// notes: rename_all_fields. Internal to the crate (deserialize from Codex JSON-RPC),
// notes: not daemon wire types.
// notes: B1 (2026-07-24) added 7 variants Codex 0.144.3 introduced: subAgentActivity,
// notes: dynamicToolCall, enteredReviewMode, exitedReviewMode, imageView, sleep,
// notes: hookPrompt. event_mapper rendering for them is B2/B3, not this file.
