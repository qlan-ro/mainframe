//! Codex's *server requests* on the way in: which Mainframe tool a
//! `requestUserInput` routes to, what `input` it carries, and which option
//! list the gate offers. The answer path back out lives in `answers.rs`.

use std::collections::HashMap;

use mainframe_adapter_api::ControlRequest;
use nanoid::nanoid;
use serde_json::{Value, json};

use crate::types::RequestId;

use super::approval_options::{approval_triad, ask_user_question_options, exit_plan_mode_options};
use super::{ApprovalHandler, PendingApproval, RespondFn};

impl ApprovalHandler {
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
        let options;

        if method == "item/commandExecution/requestApproval" {
            tool_name = "command_execution".to_string();
            tool_use_id = str_field(params, "itemId").unwrap_or_default();
            insert_if_present(&mut input, "command", params.get("command"));
            insert_if_present(&mut input, "cwd", params.get("cwd"));
            options = Some(approval_triad());
        } else if method == "item/fileChange/requestApproval" {
            tool_name = "file_change".to_string();
            tool_use_id = str_field(params, "itemId").unwrap_or_default();
            insert_if_present(&mut input, "reason", params.get("reason"));
            options = Some(approval_triad());
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

            let flat_labels: Vec<String> = option_labels
                .as_ref()
                .map(|groups| groups.iter().flatten().cloned().collect())
                .unwrap_or_default();

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
                options = Some(exit_plan_mode_options(&mainframe_request_id, &flat_labels));
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
                options = Some(ask_user_question_options(
                    &mainframe_request_id,
                    &question_text,
                    &flat_labels,
                ));
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
            options,
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
