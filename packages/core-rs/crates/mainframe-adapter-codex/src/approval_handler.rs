//! Ported from `packages/core/src/plugins/builtin/codex/approval-handler.ts`.
//!
//! Maps Codex app-server *server requests* (approvals + requestUserInput) onto the
//! Mainframe `ControlRequest`/`ControlResponse` permission flow.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::{ControlRequest, ControlResponse, SessionSink};
use mainframe_types::adapter::ControlBehavior;
use nanoid::nanoid;
use serde_json::{Value, json};

use crate::event_mapper::CurrentTurnPlan;
use crate::types::RequestId;

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

    pub fn handle_request(
        &self,
        method: &str,
        params: &Value,
        json_rpc_id: RequestId,
        respond: RespondFn,
    ) {
        let mainframe_request_id = nanoid!();

        let tool_name: String;
        let tool_use_id: String;
        let mut input: HashMap<String, Value> = HashMap::new();
        let mut option_labels: Option<Vec<Vec<String>>> = None;
        let mut questions: Option<Vec<Value>> = None;

        if method == "item/commandExecution/requestApproval" {
            tool_name = "command_execution".to_string();
            tool_use_id = str_field(params, "itemId").unwrap_or_default();
            insert_if_present(&mut input, "command", params.get("command"));
            insert_if_present(&mut input, "cwd", params.get("cwd"));
        } else if method == "item/fileChange/requestApproval" {
            tool_name = "file_change".to_string();
            tool_use_id = str_field(params, "itemId").unwrap_or_default();
            insert_if_present(&mut input, "reason", params.get("reason"));
        } else if method == "item/tool/requestUserInput" {
            tool_use_id = str_field(params, "toolCallId")
                .or_else(|| str_field(params, "itemId"))
                .unwrap_or_else(|| mainframe_request_id.clone());
            questions = params.get("questions").and_then(|v| v.as_array()).cloned();

            let raw_options = params.get("options").and_then(|v| v.as_array()).cloned();
            option_labels = raw_options.as_ref().map(|opts| {
                opts.iter()
                    .map(|group| {
                        group
                            .as_array()
                            .map(|g| {
                                g.iter()
                                    .map(|o| {
                                        o.get("label")
                                            .and_then(|l| l.as_str())
                                            .unwrap_or("")
                                            .to_string()
                                    })
                                    .collect()
                            })
                            .unwrap_or_default()
                    })
                    .collect()
            });

            let plan_ctx = self.plan_context.lock().unwrap_or_else(|e| e.into_inner());
            let is_plan_exit = plan_ctx.plan_mode
                && plan_ctx.current_turn_plan.is_some()
                && raw_options.as_ref().map(|o| o.len() == 2).unwrap_or(false);

            if is_plan_exit {
                tool_name = "ExitPlanMode".to_string();
                let plan_text = plan_ctx
                    .current_turn_plan
                    .as_ref()
                    .map(|p| p.text.clone())
                    .unwrap_or_default();
                input.insert("plan".to_string(), json!(plan_text));
                input.insert("allowedPrompts".to_string(), json!([]));
            } else {
                tool_name = "AskUserQuestion".to_string();
                let question_text = questions
                    .as_ref()
                    .map(|qs| {
                        qs.iter()
                            .map(|q| match q {
                                Value::String(s) => s.clone(),
                                _ => q
                                    .get("question")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                            })
                            .filter(|t| !t.is_empty())
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default();
                input.insert("question".to_string(), json!(question_text));
                input.insert(
                    "questions".to_string(),
                    params.get("questions").cloned().unwrap_or(Value::Null),
                );
                input.insert(
                    "options".to_string(),
                    raw_options.map(Value::Array).unwrap_or(Value::Null),
                );
            }
        } else {
            tracing::warn!(
                module = "codex:approvals",
                method,
                "codex: unknown server request method"
            );
            respond(json_rpc_id, json!({ "decision": "decline" }));
            return;
        }

        let request = ControlRequest {
            request_id: mainframe_request_id.clone(),
            tool_name: tool_name.clone(),
            tool_use_id: tool_use_id.clone(),
            input,
            suggestions: Vec::new(),
            decision_reason: None,
        };

        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(
                mainframe_request_id.clone(),
                PendingApproval {
                    json_rpc_id: json_rpc_id.clone(),
                    respond,
                    method: method.to_string(),
                    tool_name: tool_name.clone(),
                    option_labels,
                    questions,
                },
            );

        tracing::info!(
            module = "codex:approvals",
            mainframe_request_id,
            ?json_rpc_id,
            tool_name,
            tool_use_id,
            "codex approval request"
        );
        self.sink.on_permission(request);
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

        // requestUserInput expects { answers: { [questionId]: { answers: string[] } } }
        if entry.method == "item/tool/requestUserInput" {
            let answer_string = choose_request_user_input_answer(&entry, response);
            let mut answers = serde_json::Map::new();
            for qid in collect_question_ids(&entry, response) {
                answers.insert(qid, json!({ "answers": [answer_string.clone()] }));
            }
            tracing::info!(
                module = "codex:approvals",
                request_id = %response.request_id,
                behavior = ?response.behavior,
                tool_name = %entry.tool_name,
                answer_string,
                "codex user input resolved"
            );
            (entry.respond)(
                entry.json_rpc_id,
                json!({ "answers": Value::Object(answers) }),
            );
            return;
        }

        let decision = if response.behavior == ControlBehavior::Allow {
            "accept"
        } else {
            "decline"
        };
        tracing::info!(module = "codex:approvals", request_id = %response.request_id, decision, "codex approval resolved");
        (entry.respond)(entry.json_rpc_id, json!({ "decision": decision }));
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

/// Gather the question IDs that need an `answers` entry. Prefer the ids captured
/// when the request arrived; fall back to ids echoed via `response.updatedInput.questions`.
fn collect_question_ids(entry: &PendingApproval, response: &ControlResponse) -> Vec<String> {
    let from_entry: Vec<String> = entry
        .questions
        .as_ref()
        .map(|qs| {
            qs.iter()
                .filter_map(|q| match q {
                    Value::String(_) => None,
                    _ => q
                        .get("id")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string()),
                })
                .collect()
        })
        .unwrap_or_default();
    if !from_entry.is_empty() {
        return from_entry;
    }
    let echoed = response
        .updated_input
        .as_ref()
        .and_then(|m| m.get("questions"))
        .and_then(|v| v.as_array());
    let Some(echoed) = echoed else {
        return Vec::new();
    };
    echoed
        .iter()
        .filter_map(|q| {
            q.get("id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
        })
        .collect()
}

/// Decide the single answer string to deliver for a requestUserInput.
fn choose_request_user_input_answer(entry: &PendingApproval, response: &ControlResponse) -> String {
    if entry.tool_name != "ExitPlanMode" {
        // Prefer explicit message (free-text path)
        if let Some(msg) = &response.message
            && !msg.is_empty()
        {
            return msg.clone();
        }
        // Fall back to option selection delivered in updatedInput.answers
        return extract_answer_from_updated_input(response);
    }

    // Flatten option groups — Codex emits one option per group for ExitPlanMode.
    let flat_labels: Vec<String> = entry
        .option_labels
        .as_ref()
        .map(|groups| groups.iter().flatten().cloned().collect())
        .unwrap_or_default();

    let find_by_prefix = |prefix: &str, fallback_index: usize| -> String {
        if let Some(m) = flat_labels
            .iter()
            .find(|l| l.to_lowercase().starts_with(prefix))
            && !m.is_empty()
        {
            return m.clone();
        }
        match flat_labels.get(fallback_index) {
            Some(f) if !f.is_empty() => f.clone(),
            _ => response.message.clone().unwrap_or_default(),
        }
    };

    if response.behavior == ControlBehavior::Allow {
        return find_by_prefix("yes", 0);
    }

    // deny path
    if let Some(msg) = &response.message
        && !msg.is_empty()
    {
        tracing::warn!(
            module = "codex:approvals",
            request_id = %response.request_id,
            tool_name = %entry.tool_name,
            "codex: plan-exit revise free-text not supported by requestUserInput; falling back to deny option"
        );
        return find_by_prefix("no", 1);
    }
    find_by_prefix("no", 1)
}

/// Extract the user's selection from `response.updatedInput.answers` (keyed by
/// question text). Returns the first non-empty value; arrays flatten to the first.
fn extract_answer_from_updated_input(response: &ControlResponse) -> String {
    let Some(raw_answers) = response
        .updated_input
        .as_ref()
        .and_then(|m| m.get("answers"))
    else {
        return String::new();
    };
    let Some(obj) = raw_answers.as_object() else {
        return String::new();
    };
    for val in obj.values() {
        if let Some(arr) = val.as_array() {
            if let Some(first) = arr.first().and_then(|v| v.as_str())
                && !first.is_empty()
            {
                return first.to_string();
            }
        } else if let Some(s) = val.as_str()
            && !s.is_empty()
        {
            return s.to_string();
        }
    }
    String::new()
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string())
}

fn insert_if_present(input: &mut HashMap<String, Value>, key: &str, val: Option<&Value>) {
    if let Some(v) = val
        && !v.is_null()
    {
        input.insert(key.to_string(), v.clone());
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
// notes: Tests in tests/approval_handler.rs (routing + resolve, assertion-for-assertion).
