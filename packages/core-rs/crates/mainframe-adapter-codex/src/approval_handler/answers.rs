//! What `resolve` answers with: the decision an approval turns into, and the
//! single answer string a `requestUserInput` turns into.

use mainframe_adapter_api::ControlResponse;
use mainframe_types::adapter::{ControlBehavior, PermissionScope};
use serde_json::{Value, json};

use super::PendingApproval;
use super::approval_options::no_answerable_label;

/// Answer a `requestUserInput`, which expects
/// `{ answers: { [questionId]: { answers: string[] } } }`.
pub(super) fn answer_user_input(entry: PendingApproval, response: &ControlResponse) {
    // A plain deny (T19, R3.5) — ExitPlanMode is exempt: `exit_plan_mode_answer`
    // reads `behavior` to pick between the "yes"/"no" labels, which IS its real
    // answer, not an absence of one. That needs labels to pick from; with none,
    // it could only produce a blank answer Codex would take for a choice.
    let picks_its_own_label =
        entry.tool_name == "ExitPlanMode" && !no_answerable_label(&flat_labels(&entry));
    if !picks_its_own_label && response.behavior == ControlBehavior::Deny {
        tracing::info!(
            module = "codex:approvals",
            request_id = %response.request_id,
            tool_name = %entry.tool_name,
            "codex user input declined"
        );
        (entry.respond)(entry.json_rpc_id, json!({ "answers": {} }));
        return;
    }
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
}

/// Answer an approval with the decision string Codex names.
pub(super) fn answer_approval(entry: PendingApproval, response: &ControlResponse) {
    // T19, R3.2: session-scoped allow reaches Codex's own "stop asking
    // this session" decision, distinct from a one-off accept.
    let decision = match (response.behavior, response.scope) {
        (ControlBehavior::Allow, Some(PermissionScope::Session)) => "acceptForSession",
        (ControlBehavior::Allow, _) => "accept",
        (ControlBehavior::Deny, _) => "decline",
    };
    tracing::info!(module = "codex:approvals", request_id = %response.request_id, decision, "codex approval resolved");
    (entry.respond)(entry.json_rpc_id, json!({ "decision": decision }));
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

/// Codex emits one option per group for `requestUserInput`; the gate and the
/// answer both work off the flattened list.
fn flat_labels(entry: &PendingApproval) -> Vec<String> {
    entry
        .option_labels
        .as_ref()
        .map(|groups| groups.iter().flatten().cloned().collect())
        .unwrap_or_default()
}

/// Decide the single answer string to deliver for a requestUserInput.
fn choose_request_user_input_answer(entry: &PendingApproval, response: &ControlResponse) -> String {
    if entry.tool_name == "ExitPlanMode" {
        return exit_plan_mode_answer(entry, response);
    }
    // Prefer explicit message (free-text path)
    if let Some(msg) = &response.message
        && !msg.is_empty()
    {
        return msg.clone();
    }
    // Fall back to option selection delivered in updatedInput.answers
    extract_answer_from_updated_input(response)
}

/// The plan-exit answer: `behavior` picks between Codex's own "yes"/"no"
/// labels, so that choice IS the answer and `updated_input` is ignored.
fn exit_plan_mode_answer(entry: &PendingApproval, response: &ControlResponse) -> String {
    let flat_labels = flat_labels(entry);

    let find_by_prefix = |prefix: &str, fallback_index: usize| -> String {
        if let Some(m) = flat_labels
            .iter()
            .find(|l| l.to_lowercase().starts_with(prefix))
            && !m.trim().is_empty()
        {
            return m.clone();
        }
        match flat_labels.get(fallback_index) {
            Some(f) if !f.trim().is_empty() => f.clone(),
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
