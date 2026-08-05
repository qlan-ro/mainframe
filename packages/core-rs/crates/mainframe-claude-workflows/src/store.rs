//! The per-chat, per-task workflow-run store. See the plan's *The store
//! contract* for the full method-by-method behavior.
//!
//! `DashMap` guards are always dropped before `sender.send(...)` — never hold
//! a shard lock across a broadcast send.

use std::collections::HashMap;

use dashmap::DashMap;
use mainframe_types::claude_workflow::{
    ClaudeWorkflowRun, ClaudeWorkflowRunSource, ClaudeWorkflowRunStatus,
};
use serde_json::Value;
use tokio::sync::broadcast;

use crate::store_mutations::resolve_record;

const EVENT_CHANNEL_CAPACITY: usize = 256;

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
        let (sender, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        Self {
            runs: DashMap::new(),
            sender,
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<RunEvent> {
        self.sender.subscribe()
    }

    /// `task_started` with a workflow task_type. Idempotent — a task_id
    /// already held for the chat is left untouched.
    pub fn seed(&self, chat_id: &str, task_id: &str, workflow_name: Option<String>) {
        let mut chat = self.runs.entry(chat_id.to_string()).or_default();
        if chat.contains_key(task_id) {
            return;
        }
        let run = ClaudeWorkflowRun::new_seed(task_id, workflow_name);
        chat.insert(task_id.to_string(), run.clone());
        drop(chat);
        self.emit(chat_id, run);
    }

    /// Learned from the `Workflow` tool result. Idempotent; never downgrades a
    /// known `run_id`.
    pub fn link_run_id(
        &self,
        chat_id: &str,
        task_id: &str,
        run_id: &str,
        workflow_name: Option<String>,
    ) {
        let Some(mut chat) = self.runs.get_mut(chat_id) else {
            return;
        };
        let Some(run) = chat.get_mut(task_id) else {
            return;
        };
        if run.run_id.is_some() {
            return;
        }
        run.run_id = Some(run_id.to_string());
        if run.workflow_name.is_none() {
            run.workflow_name = workflow_name;
        }
        let updated = run.clone();
        drop(chat);
        self.emit(chat_id, updated);
    }

    /// `task_progress`. Cumulative totals always take `max(current, incoming)`.
    /// `snapshot: None` updates totals only and never clears structure
    /// (AC 12); a snapshot only replaces the retained structure when its
    /// revision is at least as fresh as the one already held and the run has
    /// not settled (terminal, or already record-sourced).
    pub fn apply_progress(
        &self,
        chat_id: &str,
        task_id: &str,
        usage: ProgressUsage,
        snapshot: Option<&[Value]>,
    ) {
        let Some(mut chat) = self.runs.get_mut(chat_id) else {
            return;
        };
        let Some(run) = chat.get_mut(task_id) else {
            return;
        };

        run.total_tokens = run.total_tokens.max(usage.total_tokens);
        run.duration_ms = run.duration_ms.max(usage.duration_ms);

        if let Some(entries) = snapshot {
            // D8: a settled run's structure is final, so a trailing snapshot
            // racing terminal reconciliation cannot blank it.
            let settled = run.status.is_terminal() || run.source == ClaudeWorkflowRunSource::Record;
            let retained_revision = run.structure_revision.unwrap_or(i64::MIN);
            if !settled && usage.duration_ms >= retained_revision {
                let parsed = crate::snapshot::parse_snapshot(entries);
                run.structure_revision = Some(usage.duration_ms);
                run.phases = parsed.phases;
                run.agents = parsed.agents;
                run.source = ClaudeWorkflowRunSource::Snapshot;
            }
        }

        let updated = run.clone();
        drop(chat);
        self.emit(chat_id, updated);
    }

    /// Terminal or paused stamp. Idempotent: once a run is terminal, a
    /// further stamp is a no-op — it does not restart `terminal_at`.
    pub fn stamp_status(&self, chat_id: &str, task_id: &str, status: ClaudeWorkflowRunStatus) {
        let Some(mut chat) = self.runs.get_mut(chat_id) else {
            return;
        };
        let Some(run) = chat.get_mut(task_id) else {
            return;
        };
        if run.status.is_terminal() {
            return;
        }

        run.status = status;
        if status.is_terminal() {
            run.terminal_at = Some(now_ms());
        }

        let updated = run.clone();
        drop(chat);
        self.emit(chat_id, updated);
    }

    /// Terminal reconciliation (D7): a record-sourced run supersedes the
    /// retained snapshot regardless of `structure_revision`. The disk backfill
    /// (D9) does *not* use this — it merges outside the store via
    /// `merge::merge_runs`.
    pub fn apply_record(&self, chat_id: &str, incoming: ClaudeWorkflowRun) {
        let mut chat = self.runs.entry(chat_id.to_string()).or_default();
        let task_id = incoming.task_id.clone();

        let resolved = match chat.get(&task_id) {
            Some(retained) => resolve_record(retained, &incoming),
            None => incoming,
        };

        if chat.get(&task_id) == Some(&resolved) {
            return;
        }

        chat.insert(task_id, resolved.clone());
        drop(chat);
        self.emit(chat_id, resolved);
    }

    /// D5 — the CLI-exit sweep's workflow counterpart. Only running runs are
    /// stamped; a run already terminal, or paused, is left alone.
    pub fn stop_all_running(&self, chat_id: &str) {
        let Some(mut chat) = self.runs.get_mut(chat_id) else {
            return;
        };
        let mut updated = Vec::new();
        for run in chat.values_mut() {
            if run.status == ClaudeWorkflowRunStatus::Running {
                run.status = ClaudeWorkflowRunStatus::Stopped;
                run.terminal_at = Some(now_ms());
                updated.push(run.clone());
            }
        }
        drop(chat);
        for run in updated {
            self.emit(chat_id, run);
        }
    }

    /// Sorted per *Merge precedence* rule 5:
    /// `structure_revision.or(terminal_at).unwrap_or(0)` ascending, then
    /// `task_id`.
    pub fn runs_for_chat(&self, chat_id: &str) -> Vec<ClaudeWorkflowRun> {
        let mut runs: Vec<ClaudeWorkflowRun> = self
            .runs
            .get(chat_id)
            .map(|chat| chat.values().cloned().collect())
            .unwrap_or_default();
        runs.sort_by_key(crate::merge::sort_key);
        runs
    }

    pub fn remove_chat(&self, chat_id: &str) {
        self.runs.remove(chat_id);
    }

    fn emit(&self, chat_id: &str, run: ClaudeWorkflowRun) {
        // No receivers is the normal case between subscribers; not an error.
        let _ = self.sender.send(RunEvent {
            chat_id: chat_id.to_string(),
            run,
        });
    }
}

impl Default for ClaudeWorkflowStore {
    fn default() -> Self {
        Self::new()
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
