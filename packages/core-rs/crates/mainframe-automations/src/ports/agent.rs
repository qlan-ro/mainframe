//! Agent port (T4.3): the ask_agent verb's only door into the chat system.
//! The engine renders/parses; the port starts sessions and reports their
//! terminal outcome. Production impl lives in mainframe-server (T9.2).

use crate::domain::ExpectedOutput;
use crate::engine::BoxFuture;

#[derive(Debug, Clone, thiserror::Error)]
#[error("{0}")]
pub struct AgentPortError(pub String);

#[derive(Debug, Clone, PartialEq)]
pub struct WorktreeRequest {
    pub base_branch: Option<String>,
    /// Rendered from the step's branch-name chips.
    pub branch_name: String,
}

/// Everything an ask_agent step forwards to the chat system. The prompt is
/// already rendered (chips substituted, A2 output contract appended).
/// `auto_approve`/`timeout_minutes` are forwarded engine-opaque (R6): the
/// production port must honor or loudly reject them — the engine never
/// silently drops an authored option.
#[derive(Debug, Clone, PartialEq)]
pub struct AgentRequest {
    pub prompt: String,
    pub adapter_id: String,
    pub model: Option<String>,
    pub permission_mode: Option<String>,
    pub project_id: Option<String>,
    /// The automation run creating this chat — the port stamps it onto the
    /// new chat row (`automation_run_id`) so the sessions sidebar can hide it.
    pub run_id: String,
    pub worktree: Option<WorktreeRequest>,
    pub auto_approve: Option<Vec<String>>,
    pub timeout_minutes: Option<u32>,
    /// A2 `expects`, engine-opaque to the port (parsing/retry is engine-side).
    pub expects: Vec<ExpectedOutput>,
    /// A9: image/file paths handed to the session alongside the prompt.
    pub attachments: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentHandle {
    pub chat_id: String,
}

/// How an agent session ended. `final_text` is the last assistant message —
/// the step's `result` output and the A2 parse input.
#[derive(Debug, Clone, PartialEq)]
pub enum AgentOutcome {
    Completed { final_text: String },
    Errored,
    Interrupted,
}

/// Dyn-safe (BoxFuture) so fakes and the server impl swap freely. `watch`
/// resolves when the chat reaches a terminal state; `retry` sends a
/// corrective message into the SAME session and resolves with the next
/// terminal outcome (A2's one corrective retry).
pub trait AgentPort: Send + Sync {
    fn start(&self, request: AgentRequest) -> BoxFuture<'_, Result<AgentHandle, AgentPortError>>;
    fn watch<'a>(&'a self, chat_id: &'a str)
    -> BoxFuture<'a, Result<AgentOutcome, AgentPortError>>;
    fn retry<'a>(
        &'a self,
        chat_id: &'a str,
        correction: &'a str,
    ) -> BoxFuture<'a, Result<AgentOutcome, AgentPortError>>;
    fn cancel<'a>(&'a self, chat_id: &'a str) -> BoxFuture<'a, Result<(), AgentPortError>>;
}

// PORT STATUS: greenfield (docs/plans/2026-07-12-automations-v2-rust-engine.md T4.3), not a TS port
// confidence: high
// todos: 0
// notes: Node splits this across AgentChatPort (createChatAndSend/sendMessage)
//        + chat.updated event wiring; Rust folds the waker into watch/retry
//        futures so the wait is re-attachable after restart (durable wait).
