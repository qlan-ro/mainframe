//! Ported from `packages/core/src/plugins/builtin/codex/approval-handler.ts`.
//!
//! Maps Codex app-server *server requests* (approvals + requestUserInput) onto the
//! Mainframe `ControlRequest`/`ControlResponse` permission flow: `intake.rs`
//! on the way in, `answers.rs` on the way back out, `approval_options.rs` for
//! the option list a gate offers.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{ControlResponse, SessionSink};
use serde_json::{Value, json};

use crate::event_mapper::CurrentTurnPlan;
use crate::types::RequestId;

mod answers;
mod approval_options;
mod intake;

use answers::{answer_approval, answer_user_input};

/// `respond(id, result)` — the JSON-RPC reply callback captured per request.
pub type RespondFn = Box<dyn Fn(RequestId, Value) + Send + Sync>;

#[derive(Debug, Clone, Default)]
pub struct PlanContext {
    pub plan_mode: bool,
    pub current_turn_plan: Option<CurrentTurnPlan>,
}

struct PendingApproval {
    json_rpc_id: RequestId,
    respond: RespondFn,
    method: String,
    /// The Mainframe-side routed tool name (`ExitPlanMode`/`AskUserQuestion` for
    /// `requestUserInput`, or the approval tool name otherwise).
    tool_name: String,
    /// For `requestUserInput`, rendered option labels — one inner array per option
    /// group in the order Codex emitted them.
    option_labels: Option<Vec<Vec<String>>>,
    /// For `requestUserInput`, the raw question objects (for building the answers map).
    questions: Option<Vec<Value>>,
}

pub struct ApprovalHandler {
    pending: Mutex<HashMap<String, PendingApproval>>,
    plan_context: Mutex<PlanContext>,
    sink: Arc<dyn SessionSink>,
}

impl ApprovalHandler {
    pub fn new(sink: Arc<dyn SessionSink>) -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            plan_context: Mutex::new(PlanContext::default()),
            sink,
        }
    }

    pub fn set_plan_context(&self, ctx: PlanContext) {
        *self.plan_context.lock().unwrap_or_else(|e| e.into_inner()) = ctx;
    }

    pub fn resolve(&self, response: &ControlResponse) {
        let entry = self
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&response.request_id);
        let Some(entry) = entry else {
            tracing::warn!(
                module = "codex:approvals",
                request_id = %response.request_id,
                "codex: no pending approval for requestId"
            );
            return;
        };
        if entry.method == "item/tool/requestUserInput" {
            answer_user_input(entry, response);
        } else {
            answer_approval(entry, response);
        }
    }

    pub fn reject_all(&self) {
        let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        for (_, entry) in pending.drain() {
            if entry.method == "item/tool/requestUserInput" {
                (entry.respond)(entry.json_rpc_id, json!({ "answers": {} }));
            } else {
                (entry.respond)(entry.json_rpc_id, json!({ "decision": "decline" }));
            }
        }
    }
}

// PORT STATUS: src/plugins/builtin/codex/approval-handler.ts (284 lines)
// confidence: high
// todos: 0
// notes: pending/planContext behind Mutex (CONCURRENCY.tsv 101/102, session-scoped
// notes: leaf locks). RespondFn = Box<dyn Fn(RequestId, Value) + Send + Sync> mirrors
// notes: the TS per-request respond callback. questions/options are handled as raw
// notes: serde_json Values (structural, matching TS). `insert_if_present` reproduces
// notes: the JS omit-when-undefined behavior for command/cwd/reason input keys.
// notes: Tests in tests/approval_handler/ (routing + resolve, assertion-for-assertion).
