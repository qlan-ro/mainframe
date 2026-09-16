//! Ports `__tests__/request-user-input-routing.test.ts` +
//! `__tests__/request-user-input-resolve.test.ts` assertion-for-assertion,
//! split by gate: routing, plan exit, question, approval. The fixtures the
//! four share live here.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

#[path = "approval_handler/routing.rs"]
mod routing;

#[path = "approval_handler/plan_exit.rs"]
mod plan_exit;

#[path = "approval_handler/ask_user_question.rs"]
mod ask_user_question;

#[path = "approval_handler/approvals.rs"]
mod approvals;

use std::sync::{Arc, Mutex};

use common::Recorder;
use mainframe_adapter_api::{ControlRequest, ControlResponse};
use mainframe_adapter_codex::approval_handler::{ApprovalHandler, PlanContext, RespondFn};
use mainframe_adapter_codex::event_mapper::CurrentTurnPlan;
use mainframe_adapter_codex::types::RequestId;
use serde_json::{Value, json};

type Calls = Arc<Mutex<Vec<(RequestId, Value)>>>;

fn recording_respond() -> (RespondFn, Calls) {
    let calls: Calls = Arc::new(Mutex::new(Vec::new()));
    let c = calls.clone();
    let respond: RespondFn = Box::new(move |id, v| c.lock().unwrap().push((id, v)));
    (respond, calls)
}

/// Address `decision` to the gate `request` raised.
fn decision_for(request: &ControlRequest, decision: Value) -> Value {
    let mut decision = decision;
    decision["requestId"] = json!(request.request_id);
    decision["toolUseId"] = json!(request.tool_use_id);
    decision
}

fn resolve(handler: &ApprovalHandler, v: Value) {
    let response: ControlResponse = serde_json::from_value(v).unwrap();
    handler.resolve(&response);
}

fn first_answer(calls: &Calls, qid: &str) -> String {
    let call = &calls.lock().unwrap()[0].1;
    call["answers"][qid]["answers"][0]
        .as_str()
        .unwrap()
        .to_string()
}
