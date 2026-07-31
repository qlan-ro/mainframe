//! D9 — the disk backfill composer for the chat-history `workflowRuns` fold.
//!
//! A5's bound: only the chat's *current* `claude_session_id` is scanned. Runs
//! recorded under a pre-resume session id (before the chat's last `--resume`)
//! are invisible to this backfill and render `Unavailable` — widening the scan
//! would need the chat's session lineage, which no current call site returns.

use std::path::Path;

use mainframe_claude_workflows::merge::merge_runs;
use mainframe_claude_workflows::record::read_run_records;
use mainframe_types::claude_workflow::ClaudeWorkflowRun;

use crate::ctx::AppCtx;

/// Resolves the chat's Claude session id and effective cwd (worktree path,
/// falling back to the project path), mirroring `chat_manager.rs`'s
/// `build_history_session`. `None` when either is missing.
async fn resolve_session(ctx: &AppCtx, chat_id: &str) -> Option<(String, String)> {
    let chat_id_owned = chat_id.to_string();
    let chat = ctx
        .db
        .call(move |db| db.chats.get(&chat_id_owned))
        .await
        .ok()
        .flatten()?;
    let session_id = chat.claude_session_id?;
    let cwd = match chat.worktree_path {
        Some(path) => path,
        None => {
            let project_id = chat.project_id.clone();
            ctx.db
                .call(move |db| db.projects.get(&project_id))
                .await
                .ok()
                .flatten()?
                .path
        }
    };
    Some((session_id, cwd))
}

/// Folds `ctx.claude_workflows`'s retained runs with on-disk `wf_<runId>.json`
/// records for `chat_id`'s current session, per the store contract's
/// `merge_runs` precedence. Returns the in-memory runs unchanged when the chat
/// has no Claude session or resolvable cwd (logged at `debug`).
pub async fn workflow_runs_for_chat(ctx: &AppCtx, chat_id: &str) -> Vec<ClaudeWorkflowRun> {
    let memory = ctx.claude_workflows.runs_for_chat(chat_id);
    let Some((session_id, cwd)) = resolve_session(ctx, chat_id).await else {
        tracing::debug!(
            chat_id,
            "workflow_runs_for_chat: no session/cwd to backfill from"
        );
        return memory;
    };
    let project_dir =
        mainframe_adapter_claude::transcript::get_session_jsonl_path(&session_id, &cwd).project_dir;
    let records = read_run_records(Path::new(&project_dir), &session_id).await;
    merge_runs(memory, records)
}
