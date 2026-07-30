//! The per-chat, per-task workflow-run store. See the plan's *The store
//! contract* for the full method-by-method behavior; this file only declares
//! the skeleton (A8 — red-phase tests pin the behavior before it lands).

use std::collections::HashMap;

use dashmap::DashMap;
use mainframe_types::claude_workflow::{ClaudeWorkflowRun, ClaudeWorkflowRunStatus};
use serde_json::Value;
use tokio::sync::broadcast;

/// Broadcast payload emitted on every mutating store call.
#[derive(Debug, Clone)]
pub struct RunEvent {
    pub chat_id: String,
    pub run: ClaudeWorkflowRun,
}

/// The run-cumulative totals carried on a `task_progress` event.
#[derive(Debug, Clone, Copy)]
pub struct ProgressUsage {
    pub total_tokens: i64,
    pub duration_ms: i64,
}

pub struct ClaudeWorkflowStore {
    runs: DashMap<String, HashMap<String, ClaudeWorkflowRun>>,
    sender: broadcast::Sender<RunEvent>,
}

impl ClaudeWorkflowStore {
    pub fn new() -> Self {
        unimplemented!("wf-core")
    }

    pub fn subscribe(&self) -> broadcast::Receiver<RunEvent> {
        unimplemented!("wf-core")
    }

    /// `task_started` with a workflow task_type. Idempotent.
    pub fn seed(&self, _chat_id: &str, _task_id: &str, _workflow_name: Option<String>) {
        unimplemented!("wf-core")
    }

    /// Learned from the `Workflow` tool result. Idempotent; never downgrades a
    /// known `run_id`.
    pub fn link_run_id(
        &self,
        _chat_id: &str,
        _task_id: &str,
        _run_id: &str,
        _workflow_name: Option<String>,
    ) {
        unimplemented!("wf-core")
    }

    /// `task_progress`. `snapshot: None` updates totals only and never clears
    /// structure (AC 12).
    pub fn apply_progress(
        &self,
        _chat_id: &str,
        _task_id: &str,
        _usage: ProgressUsage,
        _snapshot: Option<&[Value]>,
    ) {
        unimplemented!("wf-core")
    }

    /// Terminal or paused stamp. Idempotent: a second terminal signal does not
    /// restart duration (AC edge).
    pub fn stamp_status(&self, _chat_id: &str, _task_id: &str, _status: ClaudeWorkflowRunStatus) {
        unimplemented!("wf-core")
    }

    /// Terminal reconciliation (D7): a record-sourced run supersedes the
    /// retained snapshot regardless of `structure_revision`. The disk backfill
    /// (D9) does *not* use this — it merges outside the store via
    /// `merge::merge_runs`.
    pub fn apply_record(&self, _chat_id: &str, _run: ClaudeWorkflowRun) {
        unimplemented!("wf-core")
    }

    /// D5 — the CLI-exit sweep's workflow counterpart.
    pub fn stop_all_running(&self, _chat_id: &str) {
        unimplemented!("wf-core")
    }

    pub fn runs_for_chat(&self, _chat_id: &str) -> Vec<ClaudeWorkflowRun> {
        unimplemented!("wf-core")
    }

    pub fn remove_chat(&self, _chat_id: &str) {
        unimplemented!("wf-core")
    }
}

impl Default for ClaudeWorkflowStore {
    fn default() -> Self {
        Self::new()
    }
}
