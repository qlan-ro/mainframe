//! What `resolve` answers with: the decision an approval turns into, and the
//! single answer string a `requestUserInput` turns into.

use mainframe_adapter_api::ControlResponse;
use mainframe_types::adapter::{ControlBehavior, PermissionScope};
use serde_json::{Value, json};

use super::PendingApproval;

/// Answer a `requestUserInput`, which expects
/// `{ answers: { [questionId]: { answers: string[] } } }`.
pub(super) fn answer_user_input(entry: PendingApproval, response: &ControlResponse) {
    let Some(answer_string) = choose_request_user_input_answer(&entry, response) else {
        tracing::info!(
            module = "codex:approvals",
            request_id = %response.request_id,
            tool_name = %entry.tool_name,
            "codex user input declined"
        );
        (entry.respond)(entry.json_rpc_id, json!({ "answers": {} }));
        return;
    };
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

/// The single answer string to deliver for a requestUserInput, or `None` when
/// the response carries nothing this gate could say — a decline (T19, R3.5).
fn choose_request_user_input_answer(
    entry: &PendingApproval,
    response: &ControlResponse,
) -> Option<String> {
    if entry.tool_name == "ExitPlanMode" {
        return exit_plan_mode_answer(entry, response);
    }
    if response.behavior == ControlBehavior::Deny {
        return None;
    }
    // Prefer explicit message (free-text path)
    if let Some(msg) = &response.message
        && !msg.is_empty()
    {
        return Some(msg.clone());
    }
    // Fall back to option selection delivered in updatedInput.answers
    Some(extract_answer_from_updated_input(response))
}

/// The plan-exit answer: `behavior` picks between Codex's own "yes"/"no"
/// labels, so that choice IS the answer and `updated_input` is ignored. The
/// shipped plan card sends both directions with no message, so a blank label
/// leaves the direction unsayable — `None`, which declines. Codex then keeps
/// planning and raises the gate again, where an empty answer string would
/// have read as a real choice.
fn exit_plan_mode_answer(entry: &PendingApproval, response: &ControlResponse) -> Option<String> {
    let flat_labels = flat_labels(entry);

    let find_by_prefix = |prefix: &str, fallback_index: usize| -> Option<String> {
        if let Some(m) = flat_labels
            .iter()
            .find(|l| l.to_lowercase().starts_with(prefix))
            && !m.trim().is_empty()
        {
            return Some(m.clone());
        }
        if let Some(f) = flat_labels.get(fallback_index)
            && !f.trim().is_empty()
        {
            return Some(f.clone());
        }
        response.message.clone().filter(|msg| !msg.is_empty())
    };

    if response.behavior == ControlBehavior::Deny
        && let Some(msg) = &response.message
        && !msg.is_empty()
    {
        tracing::warn!(
            module = "codex:approvals",
            request_id = %response.request_id,
            tool_name = %entry.tool_name,
            "codex: plan-exit revise free-text not supported by requestUserInput; falling back to deny option"
        );
    }

    let (direction, answer) = match response.behavior {
        ControlBehavior::Allow => ("yes", find_by_prefix("yes", 0)),
        ControlBehavior::Deny => ("no", find_by_prefix("no", 1)),
    };
    if answer.is_none() {
        tracing::warn!(
            module = "codex:approvals",
            request_id = %response.request_id,
            tool_name = %entry.tool_name,
            direction,
            "codex: plan exit has no label for this direction; declining rather than answering blank"
        );
    }
    answer
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
