use super::*;
use mainframe_types::content::LeafContent;
use std::collections::HashSet;

/// The V2 task tools are both
/// hidden (never rendered as raw cards) AND progress (surfaced as
/// `_task_progress`); progress takes precedence over hidden in grouping.
fn claude_cats() -> ToolCategories {
    ToolCategories {
        explore: HashSet::from(["Read".to_string(), "Glob".to_string(), "Grep".to_string()]),
        hidden: HashSet::from([
            "TodoWrite".to_string(),
            "TaskCreate".to_string(),
            "TaskUpdate".to_string(),
            "TaskList".to_string(),
            "TaskGet".to_string(),
            "TaskOutput".to_string(),
            "TaskStop".to_string(),
            "Skill".to_string(),
            "EnterPlanMode".to_string(),
            "AskUserQuestion".to_string(),
        ]),
        progress: HashSet::from(["TaskCreate".to_string(), "TaskUpdate".to_string()]),
        subagent: HashSet::from(["Task".to_string()]),
    }
}

fn empty_cats() -> ToolCategories {
    ToolCategories {
        explore: HashSet::new(),
        hidden: HashSet::new(),
        progress: HashSet::new(),
        subagent: HashSet::new(),
    }
}

fn args1() -> HashMap<String, Value> {
    HashMap::from([("some".to_string(), Value::String("arg".to_string()))])
}

/// A tool-call part fixture: `id` defaults to `call-<tool_name>` and `args`
/// is always `{ "some": "arg" }`.
fn tc(
    tool_name: &str,
    id: Option<&str>,
    result: Option<Value>,
    is_error: Option<bool>,
) -> PartEntry {
    PartEntry::ToolCall {
        tool_call_id: id
            .map(str::to_string)
            .unwrap_or(format!("call-{tool_name}")),
        tool_name: tool_name.to_string(),
        args: args1(),
        result,
        is_error,
        category: None,
        parent_tool_use_id: None,
    }
}

/// A tool-call part fixture tagged with a parent tool-use id.
fn tc_tagged(tool_name: &str, id: &str, parent: &str, result: Option<Value>) -> PartEntry {
    PartEntry::ToolCall {
        tool_call_id: id.to_string(),
        tool_name: tool_name.to_string(),
        args: args1(),
        result,
        is_error: None,
        category: None,
        parent_tool_use_id: Some(parent.to_string()),
    }
}

fn tool_call_custom(
    id: &str,
    tool_name: &str,
    args: HashMap<String, Value>,
    result: Option<Value>,
    is_error: Option<bool>,
) -> PartEntry {
    PartEntry::ToolCall {
        tool_call_id: id.to_string(),
        tool_name: tool_name.to_string(),
        args,
        result,
        is_error,
        category: None,
        parent_tool_use_id: None,
    }
}

fn text(t: &str) -> PartEntry {
    PartEntry::Text {
        text: t.to_string(),
        parent_tool_use_id: None,
    }
}

fn str_val(s: &str) -> Value {
    Value::String(s.to_string())
}

fn tool_name_of(p: &PartEntry) -> &str {
    match p {
        PartEntry::ToolCall { tool_name, .. } => tool_name,
        _ => "",
    }
}

fn tool_call_id_of(p: &PartEntry) -> &str {
    match p {
        PartEntry::ToolCall { tool_call_id, .. } => tool_call_id,
        _ => "",
    }
}

/// Compact per-part label for asserting a grouped sequence.
fn label(p: &PartEntry) -> String {
    match p {
        PartEntry::Text { text, .. } => format!("text:{text}"),
        PartEntry::ToolGroup(_) => "tool:_ToolGroup".to_string(),
        PartEntry::TaskProgress(_) => "tool:_TaskProgress".to_string(),
        PartEntry::ToolCall { tool_name, .. } => format!("tool:{tool_name}"),
        _ => "tool:unknown".to_string(),
    }
}

fn group_item_ids(p: &PartEntry) -> Vec<String> {
    match p {
        PartEntry::ToolGroup(e) => e.items.iter().map(|i| i.tool_call_id.clone()).collect(),
        _ => Vec::new(),
    }
}

fn group_item_names(p: &PartEntry) -> Vec<String> {
    match p {
        PartEntry::ToolGroup(e) => e.items.iter().map(|i| i.tool_name.clone()).collect(),
        _ => Vec::new(),
    }
}

fn progress_item_ids(p: &PartEntry) -> Vec<String> {
    match p {
        PartEntry::TaskProgress(e) => e.items.iter().map(|i| i.tool_call_id.clone()).collect(),
        _ => Vec::new(),
    }
}

fn child_ids(p: &PartEntry) -> Vec<String> {
    match p {
        PartEntry::TaskGroup(e) => e
            .children
            .iter()
            .map(|c| tool_call_id_of(c).to_string())
            .collect(),
        _ => Vec::new(),
    }
}

/* ── groupToolCallParts ──────────────────────────────────────────── */

#[test]
fn returns_empty_array_for_empty_input() {
    assert_eq!(group_tool_call_parts(&[], &claude_cats()), vec![]);
}

#[test]
fn passes_through_a_single_non_tool_text_entry() {
    let parts = vec![text("hello")];
    assert_eq!(
        group_tool_call_parts(&parts, &claude_cats()),
        vec![text("hello")]
    );
}

#[test]
fn passes_through_a_single_normal_tool_call() {
    let part = tc("Bash", Some("b1"), Some(str_val("done")), None);
    let result = group_tool_call_parts(std::slice::from_ref(&part), &claude_cats());
    assert_eq!(result, vec![part]);
}

#[test]
fn passes_through_a_single_explore_tool_without_grouping() {
    let part = tc("Read", Some("r1"), Some(str_val("file content")), None);
    let result = group_tool_call_parts(std::slice::from_ref(&part), &claude_cats());
    assert_eq!(result.len(), 1);
    assert_eq!(result[0], part);
}

#[test]
fn groups_2_plus_consecutive_explore_tools_into_a_tool_group() {
    let parts = vec![
        tc("Read", Some("r1"), None, None),
        tc("Grep", Some("g1"), None, None),
        tc("Glob", Some("gl1"), None, None),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result.len(), 1);
    match &result[0] {
        PartEntry::ToolGroup(e) => {
            assert_eq!(e.tool_call_id, "r1");
            assert_eq!(e.result, "grouped");
            assert_eq!(
                e.items
                    .iter()
                    .map(|i| i.tool_name.clone())
                    .collect::<Vec<_>>(),
                vec!["Read", "Grep", "Glob"]
            );
        }
        other => panic!("expected _tool_group, got {other:?}"),
    }
}

#[test]
fn does_not_group_a_single_explore_tool() {
    let parts = vec![tc("Read", Some("r1"), None, None)];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result.len(), 1);
    assert_eq!(tool_name_of(&result[0]), "Read");
}

#[test]
fn removes_hidden_tools_from_output() {
    let parts = vec![
        tc("TodoWrite", Some("h1"), None, None),
        tc("Bash", Some("b1"), None, None),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result.len(), 1);
    assert_eq!(tool_name_of(&result[0]), "Bash");
}

#[test]
fn removes_all_hidden_tool_types() {
    let hidden_names = [
        "TaskList",
        "TaskGet",
        "TaskOutput",
        "TaskStop",
        "TodoWrite",
        "Skill",
        "EnterPlanMode",
        "AskUserQuestion",
    ];
    let parts: Vec<PartEntry> = hidden_names
        .iter()
        .map(|n| tc(n, None, None, None))
        .collect();
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result, vec![]);
}

#[test]
fn accumulates_task_progress_tools_into_a_single_task_progress_entry() {
    let parts = vec![
        tc("TaskCreate", Some("tc1"), None, None),
        tc("TaskUpdate", Some("tu1"), None, None),
    ];
    let result = group_tool_call_parts(&parts, &claude_cats());
    assert_eq!(result.len(), 1);
    match &result[0] {
        PartEntry::TaskProgress(e) => {
            assert_eq!(e.tool_call_id, "tc1");
            assert_eq!(e.result, "accumulated");
            assert_eq!(
                e.items
                    .iter()
                    .map(|i| i.tool_name.clone())
                    .collect::<Vec<_>>(),
                vec!["TaskCreate", "TaskUpdate"]
            );
        }
        other => panic!("expected _task_progress, got {other:?}"),
    }
}
