//! Shared helpers for reading V2 task-tool (TaskCreate/TaskUpdate) results.
//! Used by the daemon's cross-message subject backfill AND the UI's
//! TaskProgressCard reducer — keep the two sides' id semantics identical.

use serde_json::Value;

/// The literal prefix the CLI's TaskCreate result text uses: "Task #<id> …".
/// The TS source uses the regex `/Task #(\d+)/`; the `regex` crate is not on the
/// port allowlist, so the `\d+` match is done by hand below.
pub const TASK_ID_PREFIX: &str = "Task #";

/// Plain text of a task tool result — bare string or ToolCallResult-shaped `{ content }`.
pub(crate) fn task_result_text(result: &Value) -> String {
    if let Value::String(s) = result {
        return s.clone();
    }
    if let Value::Object(map) = result
        && let Some(Value::String(content)) = map.get("content")
    {
        return content.clone();
    }
    String::new()
}

/// The task id extracted from a TaskCreate result, or `None` when absent.
/// Mirrors `TASK_ID_RE.exec(...)?.[1]` — the digits following the first
/// `"Task #"` occurrence, or `None` when no digit follows.
pub fn extract_task_id(result: &Value) -> Option<String> {
    let text = task_result_text(result);
    let start = text.find(TASK_ID_PREFIX)? + TASK_ID_PREFIX.len();
    let digits: String = text[start..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        None
    } else {
        Some(digits)
    }
}

#[cfg(test)]
#[path = "task_progress_tests.rs"]
mod tests;
