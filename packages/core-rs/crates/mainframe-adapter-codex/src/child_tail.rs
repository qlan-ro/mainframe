//! Live-projection tail for a spawned sub-agent's rollout file.
//!
//! While a `CollabAgent` `wait` card is open, this polls the child's rollout
//! JSONL and streams newly-appended items into the parent card via a
//! `ParentIdSink`. Emissions here are transient live-projection only — nothing
//! is persisted. Full reconstruction on reload goes through the same
//! `read_rollout_items` path (B5); a daemon restart mid-wait simply drops the
//! live tail and the next reload shows the same content via the reload path —
//! by design, not a gap to fix here.

use std::sync::Arc;
use std::time::Duration;

use mainframe_adapter_api::SessionSink;
use tokio_util::sync::CancellationToken;

use crate::event_mapper::ParentIdSink;
use crate::history::{
    bash_input, is_exec_error, reasoning_text, text_block, thinking_block, tool_result_block,
    tool_use_block,
};
use crate::item_types::ThreadItem;
use crate::rollout_reader::{RolloutReaderDeps, read_rollout_items};

// One target file, watched for the lifetime of a single sub-agent wait. A
// recursive fs-watch (notify/FSEvents) has already exhausted watch handles in
// this codebase for a much smaller surface; a bounded poll on one path avoids
// that class of bug entirely.
const POLL_INTERVAL: Duration = Duration::from_millis(300);

/// Spawns a background task that tails `rollout_path` for `child_thread_id` and
/// streams newly-appended items into `sink`, tagged with `parent_tool_use_id`.
/// The caller cancels `cancel` when the parent `wait` card closes; the task
/// checks it both before polling (so a cancelled tail whose file never
/// appeared exits promptly) and after polling but before emitting (so a
/// completed wait never emits a late batch). `deps` overrides the
/// `~/.codex/sessions` containment root — `None` in production, `Some(tempdir)`
/// in tests, mirroring `read_rollout_items`'s own test seam.
pub fn spawn_child_tail(
    child_thread_id: String,
    rollout_path: String,
    sink: Arc<dyn SessionSink>,
    parent_tool_use_id: String,
    cancel: CancellationToken,
    deps: Option<RolloutReaderDeps>,
) -> tokio::task::JoinHandle<()> {
    let wrapped: Arc<dyn SessionSink> = Arc::new(ParentIdSink::new(sink, parent_tool_use_id));
    tokio::spawn(async move {
        let mut emitted_count = 0usize;
        let mut interval = tokio::time::interval(POLL_INTERVAL);
        loop {
            interval.tick().await;
            if cancel.is_cancelled() {
                return;
            }
            let items =
                read_rollout_items(&rollout_path, Some(&child_thread_id), deps.as_ref()).await;
            if cancel.is_cancelled() {
                return;
            }
            if items.len() > emitted_count {
                for item in &items[emitted_count..] {
                    render_tail_item(item, &wrapped);
                }
                emitted_count = items.len();
            }
        }
    })
}

/// Minimal per-variant rendering for the live tail — message/reasoning/exec are
/// the only shapes `read_rollout_items` reconstructs today. Deliberately not
/// `render_completed_item`: that function threads `CodexSessionState` through
/// for collab-card/compaction bookkeeping that has no meaning on a raw tail.
fn render_tail_item(item: &ThreadItem, sink: &Arc<dyn SessionSink>) {
    match item {
        ThreadItem::AgentMessage(m) => sink.on_message(vec![text_block(&m.text)], None),
        ThreadItem::Reasoning(r) => {
            let text = reasoning_text(&r.summary, &r.content);
            sink.on_message(vec![thinking_block(&text)], None);
        }
        ThreadItem::CommandExecution(c) => {
            sink.on_message(
                vec![tool_use_block(&c.id, "Bash", bash_input(&c.command))],
                None,
            );
            sink.on_tool_result(vec![tool_result_block(
                &c.id,
                &c.aggregated_output,
                is_exec_error(c.exit_code),
                None,
            )]);
        }
        ThreadItem::FileChange(_)
        | ThreadItem::McpToolCall(_)
        | ThreadItem::WebSearch(_)
        | ThreadItem::ImageGeneration(_)
        | ThreadItem::TodoList(_)
        | ThreadItem::UserMessage(_)
        | ThreadItem::CollabAgentToolCall(_)
        | ThreadItem::ContextCompaction(_)
        | ThreadItem::SubAgentActivity(_)
        | ThreadItem::DynamicToolCall(_)
        | ThreadItem::EnteredReviewMode(_)
        | ThreadItem::ExitedReviewMode(_)
        | ThreadItem::ImageView(_)
        | ThreadItem::Sleep(_)
        | ThreadItem::HookPrompt(_) => {
            tracing::debug!(
                module = "codex:events",
                "codex: child tail skipping an item shape rollout_reader doesn't reconstruct"
            );
        }
    }
}
