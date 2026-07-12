//! Ported from `packages/types/src/task-progress.ts`.
//!
//! Shared helpers for reading V2 task-tool (TaskCreate/TaskUpdate) results.
//! Used by the daemon's cross-message subject backfill AND the UI's
//! TaskProgressCard reducer — keep the two sides' id semantics identical.

use serde_json::Value;

/// The literal prefix the CLI's TaskCreate result text uses: "Task #<id> …".
/// The TS source uses the regex `/Task #(\d+)/`; the `regex` crate is not on the
/// port allowlist, so the `\d+` match is done by hand below.
pub const TASK_ID_PREFIX: &str = "Task #";

/// Plain text of a task tool result — bare string or ToolCallResult-shaped `{ content }`.
pub fn task_result_text(result: &Value) -> String {
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
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn task_result_text_returns_bare_string_as_is() {
        assert_eq!(
            task_result_text(&json!("Task #9 created successfully: Ship it")),
            "Task #9 created successfully: Ship it"
        );
    }

    #[test]
    fn task_result_text_reads_content_field() {
        assert_eq!(
            task_result_text(
                &json!({"content": "Task #9 created successfully: Ship it", "isError": false})
            ),
            "Task #9 created successfully: Ship it"
        );
    }

    #[test]
    fn task_result_text_empty_when_no_content_key() {
        assert_eq!(task_result_text(&json!({"isError": false})), "");
    }

    #[test]
    fn task_result_text_empty_for_non_object_non_string() {
        assert_eq!(task_result_text(&Value::Null), "");
        assert_eq!(task_result_text(&json!(42)), "");
    }

    #[test]
    fn extract_task_id_from_bare_string() {
        assert_eq!(
            extract_task_id(&json!("Task #9 created successfully: Ship it")).as_deref(),
            Some("9")
        );
    }

    #[test]
    fn extract_task_id_from_content_object() {
        assert_eq!(
            extract_task_id(
                &json!({"content": "Task #10 created successfully: Ship it", "isError": false})
            )
            .as_deref(),
            Some("10")
        );
    }

    #[test]
    fn extract_task_id_none_when_absent() {
        assert_eq!(extract_task_id(&Value::Null), None);
        assert_eq!(
            extract_task_id(&json!({"content": "no id here", "isError": false})),
            None
        );
    }
}

// PORT STATUS: packages/types/src/task-progress.ts (24 lines)
// confidence: high
// todos: 0
// notes: `unknown` result → serde_json::Value; JS `undefined`/`null` both map to
// Value::Null (both yield "" / None, matching the TS tests). The `/Task #(\d+)/`
// regex is hand-implemented because the `regex` crate is not on the allowlist —
// same first-match, one-or-more-digits semantics.
