//! Ported from `packages/core/src/messages/tool-grouping.ts`.
//!
//! Adapter-agnostic (§2.5 display side): post-processes a flat `PartEntry` list
//! into virtual group wrappers — explore runs collapse into `_tool_group`,
//! hidden tools are dropped, task-progress tools accumulate into one
//! `_task_progress` per parent, and subagent children nest under a `_task_group`.
//! Operates only on the neutral `DisplayContent`/`ToolCategories` types; no
//! Claude shapes.

use std::collections::HashMap;

use mainframe_types::display::DisplayContent;
use mainframe_types::display::ToolCategories;
use serde_json::Value;

use crate::tool_categorization::{
    is_explore_tool, is_hidden_tool_part, is_subagent_tool, is_task_progress_tool,
};

#[derive(Debug, Clone, PartialEq)]
pub struct ToolGroupItem {
    pub tool_name: String,
    pub tool_call_id: String,
    pub args: HashMap<String, Value>,
    pub result: Option<Value>,
    pub is_error: Option<bool>,
    pub parent_tool_use_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TaskProgressItem {
    pub tool_name: String,
    pub tool_call_id: String,
    pub args: HashMap<String, Value>,
    pub result: Option<Value>,
    pub is_error: Option<bool>,
    pub parent_tool_use_id: Option<String>,
}

/// Consecutive explore tools collapsed into one expandable group card.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolGroupEntry {
    pub tool_call_id: String,
    pub items: Vec<ToolGroupItem>,
    /// Always `"grouped"` (the TS `result: 'grouped'` literal); never read.
    pub result: &'static str,
    pub parent_tool_use_id: Option<String>,
}

/// A subagent (Task) tool plus every part tagged with its tool_use id.
#[derive(Debug, Clone, PartialEq)]
pub struct TaskGroupEntry {
    pub tool_call_id: String,
    pub task_args: HashMap<String, Value>,
    pub children: Vec<PartEntry>,
    pub result: Option<Value>,
    pub is_error: Option<bool>,
    pub parent_tool_use_id: Option<String>,
}

/// Task-progress tools accumulated into one progress feed entry per parent.
#[derive(Debug, Clone, PartialEq)]
pub struct TaskProgressEntry {
    pub tool_call_id: String,
    pub items: Vec<TaskProgressItem>,
    /// Always `"accumulated"` (the TS `result: 'accumulated'` literal); never read.
    pub result: &'static str,
    pub parent_tool_use_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PartEntry {
    ToolCall {
        tool_call_id: String,
        tool_name: String,
        args: HashMap<String, Value>,
        result: Option<Value>,
        is_error: Option<bool>,
        category: Option<String>,
        parent_tool_use_id: Option<String>,
    },
    Text {
        text: String,
        parent_tool_use_id: Option<String>,
    },
    /// Non-groupable content (thinking, image, …) carried through in-place.
    Passthrough {
        content: DisplayContent,
        parent_tool_use_id: Option<String>,
    },
    ToolGroup(ToolGroupEntry),
    TaskGroup(TaskGroupEntry),
    TaskProgress(TaskProgressEntry),
}

/// Borrowed view of a `PartEntry::ToolCall`'s fields, used by the grouping scan.
struct ToolCallRef<'a> {
    tool_call_id: &'a str,
    tool_name: &'a str,
    args: &'a HashMap<String, Value>,
    result: &'a Option<Value>,
    is_error: Option<bool>,
    category: Option<&'a str>,
    parent_tool_use_id: &'a Option<String>,
}

impl PartEntry {
    fn as_tool_call(&self) -> Option<ToolCallRef<'_>> {
        match self {
            PartEntry::ToolCall {
                tool_call_id,
                tool_name,
                args,
                result,
                is_error,
                category,
                parent_tool_use_id,
            } => Some(ToolCallRef {
                tool_call_id,
                tool_name,
                args,
                result,
                is_error: *is_error,
                category: category.as_deref(),
                parent_tool_use_id,
            }),
            _ => None,
        }
    }

    /// Every `PartEntry` variant carries an optional `parentToolUseId`.
    fn parent_tool_use_id(&self) -> Option<&str> {
        match self {
            PartEntry::ToolCall {
                parent_tool_use_id, ..
            }
            | PartEntry::Text {
                parent_tool_use_id, ..
            }
            | PartEntry::Passthrough {
                parent_tool_use_id, ..
            } => parent_tool_use_id.as_deref(),
            PartEntry::ToolGroup(e) => e.parent_tool_use_id.as_deref(),
            PartEntry::TaskGroup(e) => e.parent_tool_use_id.as_deref(),
            PartEntry::TaskProgress(e) => e.parent_tool_use_id.as_deref(),
        }
    }
}

/// Mirrors the TS `tc.parentToolUseId && { parentToolUseId }` truthy check —
/// `undefined` and `""` both collapse to `None`.
fn truthy(value: &Option<String>) -> Option<String> {
    match value {
        Some(v) if !v.is_empty() => Some(v.clone()),
        _ => None,
    }
}

/// Mirrors the TS truthy guard on a borrowed id — `None` and `""` → `None`.
fn truthy_str(value: Option<&str>) -> Option<&str> {
    match value {
        Some(v) if !v.is_empty() => Some(v),
        _ => None,
    }
}

fn tool_group_item_from(tc: &ToolCallRef<'_>) -> ToolGroupItem {
    ToolGroupItem {
        tool_name: tc.tool_name.to_string(),
        tool_call_id: tc.tool_call_id.to_string(),
        args: tc.args.clone(),
        result: tc.result.clone(),
        is_error: tc.is_error,
        parent_tool_use_id: truthy(tc.parent_tool_use_id),
    }
}

/// One progress feed accumulator per `parentToolUseId` (the raw key — `None` for
/// the main agent, distinct from `Some("")`). `insert_index` anchors the splice
/// position at `result.len()` when the parent's first progress tool is seen.
struct ProgressBucket {
    key: Option<String>,
    insert_index: usize,
    items: Vec<TaskProgressItem>,
}

/// Accumulate a progress tool into its parent's bucket, anchoring the bucket's
/// insert position at the first one seen. Shared by the main loop and the
/// explore look-ahead (mirroring the TS `collectTaskItem` closure).
fn collect_task_item(buckets: &mut Vec<ProgressBucket>, result_len: usize, tc: &ToolCallRef<'_>) {
    let key = tc.parent_tool_use_id.clone();
    let pos = match buckets.iter().position(|b| b.key == key) {
        Some(i) => i,
        None => {
            buckets.push(ProgressBucket {
                key,
                insert_index: result_len,
                items: Vec::new(),
            });
            buckets.len() - 1
        }
    };
    buckets[pos].items.push(TaskProgressItem {
        tool_call_id: tc.tool_call_id.to_string(),
        tool_name: tc.tool_name.to_string(),
        args: tc.args.clone(),
        result: tc.result.clone(),
        is_error: tc.is_error,
        parent_tool_use_id: truthy(tc.parent_tool_use_id),
    });
}

/// Post-processes parts to group consecutive explore tools, suppress hidden
/// tools, and accumulate task-progress tools into one `_task_progress` entry per
/// parent. Categories are adapter-declared — pass the adapter's `ToolCategories`.
pub fn group_tool_call_parts(parts: &[PartEntry], categories: &ToolCategories) -> Vec<PartEntry> {
    let mut result: Vec<PartEntry> = Vec::new();
    // Progress tools accumulate per parentToolUseId (None = main agent), so a
    // subagent's progress feed stays single-parented and can nest inside its
    // task group instead of merging with the main agent's into one mixed entry.
    let mut buckets: Vec<ProgressBucket> = Vec::new();
    let mut i = 0usize;

    while i < parts.len() {
        let part = &parts[i];

        let tc = match part.as_tool_call() {
            Some(tc) => tc,
            None => {
                result.push(part.clone());
                i += 1;
                continue;
            }
        };

        // Collect task progress tools for accumulated display. Checked BEFORE the
        // hidden suppression: adapters mark the V2 task tools as both `hidden` (so
        // they never render as raw tool cards) and `progress` (so they surface as a
        // _TaskProgress entry). Progress must win, or they'd be dropped.
        if is_task_progress_tool(tc.tool_name, categories) {
            collect_task_item(&mut buckets, result.len(), &tc);
            i += 1;
            continue;
        }

        // Skip hidden tools
        if is_hidden_tool_part(tc.tool_name, tc.category, categories) {
            i += 1;
            continue;
        }

        if is_explore_tool(tc.tool_name, categories) {
            i = collect_explore_run(parts, i, &mut result, categories, &mut buckets);
            continue;
        }

        // Everything else passes through
        result.push(part.clone());
        i += 1;
    }

    splice_progress_entries(&mut result, buckets);
    result
}

/// Collects the run of consecutive explore tools starting at `start` into a
/// `_tool_group` (pushed bare when the run has one member) and returns the index
/// of the first part after the run. A part whose `parentToolUseId` differs from
/// the run's first tool ends the run, so a subagent's explore burst never merges
/// with the main agent's (or another subagent's) adjacent tools.
fn collect_explore_run(
    parts: &[PartEntry],
    start: usize,
    result: &mut Vec<PartEntry>,
    categories: &ToolCategories,
    buckets: &mut Vec<ProgressBucket>,
) -> usize {
    // Caller guarantees `parts[start]` is an explore tool-call.
    let Some(first) = parts[start].as_tool_call() else {
        result.push(parts[start].clone());
        return start + 1;
    };
    let run_parent: Option<String> = first.parent_tool_use_id.clone();
    let mut group: Vec<ToolGroupItem> = vec![tool_group_item_from(&first)];
    let first_id = first.tool_call_id.to_string();
    let mut j = start + 1;
    while j < parts.len() {
        let next = match parts[j].as_tool_call() {
            Some(next) => next,
            None => break,
        };
        if *next.parent_tool_use_id != run_parent {
            break;
        }
        if is_explore_tool(next.tool_name, categories) {
            group.push(tool_group_item_from(&next));
        } else if is_task_progress_tool(next.tool_name, categories) {
            // A progress tool inside the run is accumulated, not dropped.
            collect_task_item(buckets, result.len(), &next);
        } else if !is_hidden_tool_part(next.tool_name, next.category, categories) {
            break;
        }
        // hidden tools within the run are skipped
        j += 1;
    }

    if group.len() >= 2 {
        result.push(PartEntry::ToolGroup(ToolGroupEntry {
            tool_call_id: first_id,
            items: group,
            result: "grouped",
            parent_tool_use_id: truthy(&run_parent),
        }));
    } else {
        // run of one → push the original part unchanged.
        result.push(parts[start].clone());
    }
    j
}

/// Splices one `_task_progress` entry per parent bucket into `result`, each at
/// the position where that parent's first progress tool was seen. Ascending
/// insert order with an offset keeps every recorded index valid as earlier
/// splices shift the vec. `sort_by` is stable, so buckets sharing an insert
/// index keep their first-seen order (matching JS `Map` iteration + stable sort).
fn splice_progress_entries(result: &mut Vec<PartEntry>, mut buckets: Vec<ProgressBucket>) {
    buckets.sort_by(|a, b| a.insert_index.cmp(&b.insert_index));
    let mut offset = 0usize;
    for bucket in buckets {
        let Some(first_id) = bucket.items.first().map(|it| it.tool_call_id.clone()) else {
            continue;
        };
        let entry = PartEntry::TaskProgress(TaskProgressEntry {
            tool_call_id: first_id,
            parent_tool_use_id: truthy(&bucket.key),
            items: bucket.items,
            result: "accumulated",
        });
        result.insert(bucket.insert_index + offset, entry);
        offset += 1;
    }
}

/// Slot in the partition pass: either a top-level part kept in place, or a marker
/// for a `_task_group` whose children are still being gathered into `groups`.
enum Slot {
    Part(Box<PartEntry>),
    Group(String),
}

/// Partitions a turn's parts into per-Task buckets: every part tagged with a
/// subagent tool-call's id nests under that Task as a `_task_group` child,
/// regardless of position — parallel Tasks interleave their children, and a
/// Task's children can arrive after unrelated main-agent parts. Untagged parts
/// stay top-level in order. A tag matching no Task in this turn is subagent
/// content whose parent is not visible here (nested-Task grandchildren) — it is
/// dropped, never rendered in the main flow. Categories are adapter-declared.
pub fn group_task_children(parts: &[PartEntry], categories: &ToolCategories) -> Vec<PartEntry> {
    let mut groups: HashMap<String, TaskGroupEntry> = HashMap::new();
    for part in parts {
        if let Some(tc) = part.as_tool_call()
            && truthy(tc.parent_tool_use_id).is_none()
            && is_subagent_tool(tc.tool_name, categories)
        {
            groups.insert(
                tc.tool_call_id.to_string(),
                TaskGroupEntry {
                    tool_call_id: tc.tool_call_id.to_string(),
                    task_args: tc.args.clone(),
                    children: Vec::new(),
                    result: tc.result.clone(),
                    is_error: tc.is_error,
                    parent_tool_use_id: None,
                },
            );
        }
    }

    let mut slots: Vec<Slot> = Vec::new();
    let mut bare_tasks: HashMap<String, PartEntry> = HashMap::new();
    for part in parts {
        if let Some(tc) = part.as_tool_call()
            && truthy(tc.parent_tool_use_id).is_none()
            && groups.contains_key(tc.tool_call_id)
        {
            bare_tasks.insert(tc.tool_call_id.to_string(), part.clone());
            slots.push(Slot::Group(tc.tool_call_id.to_string()));
            continue;
        }
        if let Some(parent) = truthy_str(part.parent_tool_use_id()) {
            // An unknown parent (no matching Task in this turn) drops the part.
            if let Some(group) = groups.get_mut(parent) {
                group.children.push(part.clone());
            }
            continue;
        }
        slots.push(Slot::Part(Box::new(part.clone())));
    }

    // A Task that gathered no children renders as its original bare tool-call.
    slots
        .into_iter()
        .map(|slot| match slot {
            Slot::Part(p) => *p,
            Slot::Group(id) => match groups.get(&id) {
                Some(group) if group.children.is_empty() => bare_tasks
                    .get(&id)
                    .cloned()
                    .unwrap_or_else(|| PartEntry::TaskGroup(group.clone())),
                Some(group) => PartEntry::TaskGroup(group.clone()),
                // Unreachable: Group(id) is only pushed when `groups` has `id`.
                None => bare_tasks.get(&id).cloned().unwrap_or(PartEntry::Text {
                    text: String::new(),
                    parent_tool_use_id: None,
                }),
            },
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    /// Mirrors `ClaudeAdapter.getToolCategories()`: the V2 task tools are BOTH
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

    /// `tc(toolName, id?, result?, isError?)` from the TS fixtures; `id` defaults
    /// to `call-${toolName}` and `args` is always `{ some: 'arg' }`.
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

    /// `tcTagged(toolName, id, parentToolUseId, result?)` from the TS fixtures.
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

    /// Compact per-part label matching the TS `names` mappers.
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

    #[test]
    fn places_task_progress_at_the_position_of_the_first_task_tool() {
        let parts = vec![
            tc("Bash", Some("b1"), None, None),
            tc("TaskCreate", Some("tc1"), None, None),
            tc("Edit", Some("e1"), None, None),
            tc("TaskUpdate", Some("tu1"), None, None),
        ];
        let result = group_tool_call_parts(&parts, &claude_cats());
        assert_eq!(result.len(), 3);
        assert_eq!(tool_name_of(&result[0]), "Bash");
        assert!(matches!(result[1], PartEntry::TaskProgress(_)));
        assert_eq!(tool_name_of(&result[2]), "Edit");
    }

    #[test]
    fn skips_hidden_tools_interspersed_between_explore_tools_when_grouping() {
        let parts = vec![
            tc("Read", Some("r1"), None, None),
            tc("TodoWrite", Some("h1"), None, None),
            tc("Grep", Some("g1"), None, None),
        ];
        let result = group_tool_call_parts(&parts, &claude_cats());
        assert_eq!(result.len(), 1);
        assert_eq!(group_item_names(&result[0]), vec!["Read", "Grep"]);
    }

    #[test]
    fn skips_task_progress_tools_interspersed_between_explore_tools_when_grouping() {
        let parts = vec![
            tc("Read", Some("r1"), None, None),
            tc("TaskCreate", Some("tc1"), None, None),
            tc("Glob", Some("gl1"), None, None),
        ];
        let result = group_tool_call_parts(&parts, &claude_cats());
        let tool_group = result
            .iter()
            .find(|p| matches!(p, PartEntry::ToolGroup(_)))
            .expect("expected _tool_group");
        assert_eq!(group_item_names(tool_group), vec!["Read", "Glob"]);
    }

    #[test]
    fn breaks_explore_group_on_a_non_explore_non_hidden_non_task_tool() {
        let parts = vec![
            tc("Read", Some("r1"), None, None),
            tc("Bash", Some("b1"), None, None),
            tc("Grep", Some("g1"), None, None),
        ];
        let result = group_tool_call_parts(&parts, &claude_cats());
        assert_eq!(result.len(), 3);
        assert_eq!(tool_name_of(&result[0]), "Read");
        assert_eq!(tool_name_of(&result[1]), "Bash");
        assert_eq!(tool_name_of(&result[2]), "Grep");
    }

    #[test]
    fn breaks_explore_group_on_a_text_entry() {
        let parts = vec![
            tc("Read", Some("r1"), None, None),
            text("thinking..."),
            tc("Grep", Some("g1"), None, None),
        ];
        let result = group_tool_call_parts(&parts, &claude_cats());
        assert_eq!(result.len(), 3);
        assert_eq!(tool_name_of(&result[0]), "Read");
        assert_eq!(result[1], text("thinking..."));
        assert_eq!(tool_name_of(&result[2]), "Grep");
    }

    #[test]
    fn handles_mixed_text_explore_hidden_task_and_normal_tools() {
        let parts = vec![
            text("starting"),
            tc("Read", Some("r1"), None, None),
            tc("Grep", Some("g1"), None, None),
            tc("TodoWrite", Some("h1"), None, None),
            tc("TaskCreate", Some("tc1"), None, None),
            tc("Bash", Some("b1"), None, None),
            text("done"),
        ];
        let result = group_tool_call_parts(&parts, &claude_cats());
        let names: Vec<String> = result.iter().map(label).collect();
        assert_eq!(
            names,
            vec![
                "text:starting",
                "tool:_TaskProgress",
                "tool:_ToolGroup",
                "tool:Bash",
                "text:done"
            ]
        );
    }

    #[test]
    fn produces_task_progress_when_task_tools_are_not_inside_an_explore_run() {
        let parts = vec![
            tc("TaskCreate", Some("tc1"), None, None),
            tc("Bash", Some("b1"), None, None),
            tc("TaskUpdate", Some("tu1"), None, None),
        ];
        let result = group_tool_call_parts(&parts, &claude_cats());
        let names: Vec<String> = result.iter().map(label).collect();
        assert_eq!(names, vec!["tool:_TaskProgress", "tool:Bash"]);
    }

    #[test]
    fn preserves_tool_call_args_and_result_through_grouping() {
        let parts = vec![
            tool_call_custom(
                "r1",
                "Read",
                HashMap::from([("file".to_string(), str_val("/a.ts"))]),
                Some(str_val("content A")),
                None,
            ),
            tool_call_custom(
                "g1",
                "Grep",
                HashMap::from([("pattern".to_string(), str_val("foo"))]),
                Some(str_val("match")),
                None,
            ),
        ];
        let result = group_tool_call_parts(&parts, &claude_cats());
        match &result[0] {
            PartEntry::ToolGroup(e) => {
                assert_eq!(
                    e.items[0].args,
                    HashMap::from([("file".to_string(), str_val("/a.ts"))])
                );
                assert_eq!(e.items[0].result, Some(str_val("content A")));
                assert_eq!(
                    e.items[1].args,
                    HashMap::from([("pattern".to_string(), str_val("foo"))])
                );
                assert_eq!(e.items[1].result, Some(str_val("match")));
            }
            other => panic!("expected _tool_group, got {other:?}"),
        }
    }

    #[test]
    fn preserves_is_error_on_grouped_explore_tools() {
        let parts = vec![
            tool_call_custom(
                "r1",
                "Read",
                HashMap::new(),
                Some(str_val("err")),
                Some(true),
            ),
            tool_call_custom(
                "g1",
                "Glob",
                HashMap::new(),
                Some(str_val("ok")),
                Some(false),
            ),
        ];
        let result = group_tool_call_parts(&parts, &claude_cats());
        match &result[0] {
            PartEntry::ToolGroup(e) => {
                assert_eq!(e.items[0].is_error, Some(true));
                assert_eq!(e.items[1].is_error, Some(false));
            }
            other => panic!("expected _tool_group, got {other:?}"),
        }
    }

    /* ── groupToolCallParts — parent boundaries ──────────────────────── */

    #[test]
    fn ends_an_explore_run_when_the_next_tool_belongs_to_a_different_parent() {
        let parts = vec![
            tc_tagged("Read", "r1", "t1", None),
            tc_tagged("Grep", "g1", "t1", None),
            tc("Grep", Some("g2"), None, None),
        ];
        let result = group_tool_call_parts(&parts, &claude_cats());
        assert_eq!(result.len(), 2);
        match &result[0] {
            PartEntry::ToolGroup(e) => {
                assert_eq!(e.parent_tool_use_id.as_deref(), Some("t1"));
                assert_eq!(group_item_ids(&result[0]), vec!["r1", "g1"]);
            }
            other => panic!("expected _tool_group, got {other:?}"),
        }
        assert_eq!(tool_call_id_of(&result[1]), "g2");
        assert_eq!(result[1].parent_tool_use_id(), None);
    }

    #[test]
    fn keeps_a_main_agent_explore_solo_when_followed_by_a_tagged_subagent_burst() {
        let parts = vec![
            tc("Read", Some("r0"), None, None),
            tc_tagged("Read", "r1", "t1", None),
            tc_tagged("Grep", "g1", "t1", None),
        ];
        let result = group_tool_call_parts(&parts, &claude_cats());
        assert_eq!(result.len(), 2);
        assert_eq!(tool_call_id_of(&result[0]), "r0");
        match &result[1] {
            PartEntry::ToolGroup(e) => {
                assert_eq!(e.parent_tool_use_id.as_deref(), Some("t1"));
                assert_eq!(group_item_ids(&result[1]), vec!["r1", "g1"]);
            }
            other => panic!("expected _tool_group, got {other:?}"),
        }
    }

    #[test]
    fn accumulates_task_progress_per_parent_one_tagged_one_untagged() {
        let parts = vec![
            tc("Task", Some("t1"), None, None),
            tc_tagged("TaskCreate", "p1", "t1", None),
            tc("TaskCreate", Some("p0"), None, None),
            tc_tagged("TaskUpdate", "p3", "t1", None),
            tc("TaskUpdate", Some("p2"), None, None),
        ];
        let result = group_tool_call_parts(&parts, &claude_cats());
        assert_eq!(result.len(), 3);
        assert_eq!(tool_name_of(&result[0]), "Task");

        match &result[1] {
            PartEntry::TaskProgress(e) => {
                assert_eq!(e.parent_tool_use_id.as_deref(), Some("t1"));
                assert_eq!(progress_item_ids(&result[1]), vec!["p1", "p3"]);
            }
            other => panic!("expected _task_progress, got {other:?}"),
        }
        match &result[2] {
            PartEntry::TaskProgress(e) => {
                assert_eq!(e.parent_tool_use_id, None);
                assert_eq!(progress_item_ids(&result[2]), vec!["p0", "p2"]);
            }
            other => panic!("expected _task_progress, got {other:?}"),
        }
    }

    /* ── groupTaskChildren — partitioning ────────────────────────────── */

    #[test]
    fn routes_interleaved_children_of_parallel_tasks_to_their_own_task_groups() {
        let parts = vec![
            tc("Task", Some("tA"), None, None),
            tc("Task", Some("tB"), None, None),
            tc_tagged("Bash", "a1", "tA", Some(str_val("out-a1"))),
            tc_tagged("Bash", "b1", "tB", Some(str_val("out-b1"))),
            tc_tagged("Read", "a2", "tA", None),
        ];
        let result = group_task_children(&parts, &claude_cats());
        assert_eq!(result.len(), 2);
        match (&result[0], &result[1]) {
            (PartEntry::TaskGroup(a), PartEntry::TaskGroup(b)) => {
                assert_eq!(a.tool_call_id, "tA");
                assert_eq!(child_ids(&result[0]), vec!["a1", "a2"]);
                assert_eq!(b.tool_call_id, "tB");
                assert_eq!(child_ids(&result[1]), vec!["b1"]);
            }
            other => panic!("expected two _task_group, got {other:?}"),
        }
    }

    #[test]
    fn groups_children_that_arrive_after_an_untagged_main_tool_in_the_same_turn() {
        let parts = vec![
            tc("Task", Some("t1"), None, None),
            tc("Bash", Some("m1"), None, None),
            tc_tagged("Bash", "c1", "t1", None),
            tc_tagged("Read", "c2", "t1", None),
        ];
        let result = group_task_children(&parts, &claude_cats());
        assert_eq!(result.len(), 2);
        match &result[0] {
            PartEntry::TaskGroup(e) => {
                assert_eq!(e.tool_call_id, "t1");
                assert_eq!(child_ids(&result[0]), vec!["c1", "c2"]);
            }
            other => panic!("expected _task_group, got {other:?}"),
        }
        assert_eq!(tool_call_id_of(&result[1]), "m1");
    }

    #[test]
    fn drops_parts_tagged_with_an_unknown_parent_id() {
        let parts = vec![
            tc("Task", Some("t1"), None, None),
            tc_tagged("Bash", "c1", "t1", None),
            tc_tagged("Bash", "x1", "toolu_unknown", None),
        ];
        let result = group_task_children(&parts, &claude_cats());
        assert_eq!(result.len(), 1);
        assert_eq!(child_ids(&result[0]), vec!["c1"]);
    }

    /* ── with empty categories (no grouping) ─────────────────────────── */

    #[test]
    fn passes_all_tool_calls_through_ungrouped_with_empty_categories() {
        let parts = vec![
            tc("Read", Some("r1"), None, None),
            tc("Grep", Some("g1"), None, None),
            tc("TodoWrite", Some("h1"), None, None),
        ];
        let result = group_tool_call_parts(&parts, &empty_cats());
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn does_not_create_task_group_entries_with_empty_categories() {
        let parts = vec![
            tc("Task", Some("t1"), None, None),
            tc("Bash", Some("b1"), None, None),
        ];
        let result = group_task_children(&parts, &empty_cats());
        assert_eq!(result.len(), 2);
        assert_eq!(tool_name_of(&result[0]), "Task");
    }

    /* ── groupTaskChildren ───────────────────────────────────────────── */

    #[test]
    fn group_task_children_returns_empty_array_for_empty_input() {
        assert_eq!(group_task_children(&[], &claude_cats()), vec![]);
    }

    #[test]
    fn passes_through_parts_with_no_task_tool_call() {
        let parts = vec![
            text("hello"),
            tc("Bash", Some("b1"), None, None),
            text("done"),
        ];
        let result = group_task_children(&parts, &claude_cats());
        assert_eq!(result, parts);
    }

    #[test]
    fn wraps_a_task_plus_tagged_subsequent_tool_calls_into_a_task_group() {
        let parts = vec![
            tc("Task", Some("t1"), None, None),
            tc_tagged("Bash", "b1", "t1", Some(str_val("output"))),
            tc_tagged("Read", "r1", "t1", Some(str_val("file"))),
        ];
        let result = group_task_children(&parts, &claude_cats());
        assert_eq!(result.len(), 1);
        match &result[0] {
            PartEntry::TaskGroup(e) => {
                assert_eq!(e.tool_call_id, "t1");
                assert_eq!(e.children.len(), 2);
                assert_eq!(
                    e.children[0],
                    tc_tagged("Bash", "b1", "t1", Some(str_val("output")))
                );
                assert_eq!(
                    e.children[1],
                    tc_tagged("Read", "r1", "t1", Some(str_val("file")))
                );
            }
            other => panic!("expected _task_group, got {other:?}"),
        }
    }

    #[test]
    fn preserves_task_args_in_task_args() {
        let parts = vec![
            tool_call_custom(
                "t1",
                "Task",
                HashMap::from([("description".to_string(), str_val("do stuff"))]),
                None,
                None,
            ),
            tc_tagged("Bash", "b1", "t1", None),
        ];
        let result = group_task_children(&parts, &claude_cats());
        match &result[0] {
            PartEntry::TaskGroup(e) => {
                assert_eq!(
                    e.task_args,
                    HashMap::from([("description".to_string(), str_val("do stuff"))])
                );
            }
            other => panic!("expected _task_group, got {other:?}"),
        }
    }

    #[test]
    fn keeps_untagged_entries_top_level_alongside_the_task_group() {
        let parts = vec![
            tc("Task", Some("t1"), None, None),
            tc_tagged("Bash", "b1", "t1", None),
            text("middle"),
            tc("Edit", Some("e1"), None, None),
        ];
        let result = group_task_children(&parts, &claude_cats());
        assert_eq!(result.len(), 3);
        match &result[0] {
            PartEntry::TaskGroup(e) => {
                assert_eq!(e.children.len(), 1);
                assert_eq!(e.children[0], tc_tagged("Bash", "b1", "t1", None));
            }
            other => panic!("expected _task_group, got {other:?}"),
        }
        assert_eq!(result[1], text("middle"));
        assert_eq!(tool_name_of(&result[2]), "Edit");
    }

    #[test]
    fn routes_children_tagged_for_different_parents_to_their_own_task_groups() {
        let parts = vec![
            tc("Task", Some("t1"), None, None),
            tc_tagged("Bash", "b1", "t1", None),
            tc("Task", Some("t2"), None, None),
            tc_tagged("Read", "r1", "t2", None),
        ];
        let result = group_task_children(&parts, &claude_cats());
        assert_eq!(result.len(), 2);
        match (&result[0], &result[1]) {
            (PartEntry::TaskGroup(g1), PartEntry::TaskGroup(g2)) => {
                assert_eq!(g1.tool_call_id, "t1");
                assert_eq!(g2.tool_call_id, "t2");
                assert_eq!(g1.children.len(), 1);
                assert_eq!(g1.children[0], tc_tagged("Bash", "b1", "t1", None));
                assert_eq!(g2.children.len(), 1);
                assert_eq!(g2.children[0], tc_tagged("Read", "r1", "t2", None));
            }
            other => panic!("expected two _task_group, got {other:?}"),
        }
    }

    #[test]
    fn leaves_a_task_with_no_children_as_a_plain_task_entry() {
        let parts = vec![tc("Task", Some("t1"), None, None), text("after")];
        let result = group_task_children(&parts, &claude_cats());
        assert_eq!(result.len(), 2);
        assert_eq!(tool_name_of(&result[0]), "Task");
        assert_eq!(result[1], text("after"));
    }

    #[test]
    fn leaves_a_trailing_task_with_no_children_as_a_plain_task_entry() {
        let parts = vec![text("before"), tc("Task", Some("t1"), None, None)];
        let result = group_task_children(&parts, &claude_cats());
        assert_eq!(result.len(), 2);
        assert_eq!(result[0], text("before"));
        assert_eq!(tool_name_of(&result[1]), "Task");
    }

    #[test]
    fn preserves_result_and_is_error_on_task_group() {
        let parts = vec![
            tool_call_custom(
                "t1",
                "Task",
                HashMap::new(),
                Some(str_val("task done")),
                Some(false),
            ),
            tc_tagged("Bash", "b1", "t1", None),
        ];
        let result = group_task_children(&parts, &claude_cats());
        match &result[0] {
            PartEntry::TaskGroup(e) => {
                assert_eq!(e.result, Some(str_val("task done")));
                assert_eq!(e.is_error, Some(false));
            }
            other => panic!("expected _task_group, got {other:?}"),
        }
    }

    #[test]
    fn nests_a_tagged_tool_group_inside_the_parent_task_group() {
        let task_id = "t-agent";
        let explore_items = vec![
            tc_tagged("Read", "r1", task_id, None),
            tc_tagged("Grep", "g1", task_id, None),
            tc_tagged("Glob", "gl1", task_id, None),
        ];
        let grouped = group_tool_call_parts(&explore_items, &claude_cats());
        assert_eq!(grouped.len(), 1);
        assert!(matches!(grouped[0], PartEntry::ToolGroup(_)));

        let mut parts = vec![tc("Task", Some(task_id), None, None)];
        parts.extend(grouped);
        let result = group_task_children(&parts, &claude_cats());
        assert_eq!(result.len(), 1);
        match &result[0] {
            PartEntry::TaskGroup(e) => {
                assert_eq!(e.children.len(), 1);
                assert!(matches!(e.children[0], PartEntry::ToolGroup(_)));
            }
            other => panic!("expected _task_group, got {other:?}"),
        }
    }

    /* ── AskUserQuestion (ported from tool-grouping-askuserquestion.test.ts) ── */

    fn auq_cats() -> ToolCategories {
        ToolCategories {
            explore: HashSet::new(),
            hidden: HashSet::from(["AskUserQuestion".to_string()]),
            progress: HashSet::new(),
            subagent: HashSet::new(),
        }
    }

    fn tool_call_cat(id: &str, name: &str, category: Option<&str>) -> PartEntry {
        PartEntry::ToolCall {
            tool_call_id: id.to_string(),
            tool_name: name.to_string(),
            args: HashMap::new(),
            result: None,
            is_error: None,
            category: category.map(str::to_string),
            parent_tool_use_id: None,
        }
    }

    #[test]
    fn keeps_an_answered_default_ask_user_question_part() {
        let out = group_tool_call_parts(
            &[tool_call_cat("a", "AskUserQuestion", Some("default"))],
            &auq_cats(),
        );
        assert!(out.iter().any(|p| matches!(
            p,
            PartEntry::ToolCall { tool_call_id, .. } if tool_call_id == "a"
        )));
    }

    #[test]
    fn drops_a_pending_hidden_ask_user_question_part() {
        let out = group_tool_call_parts(
            &[tool_call_cat("b", "AskUserQuestion", Some("hidden"))],
            &auq_cats(),
        );
        assert!(!out.iter().any(|p| matches!(
            p,
            PartEntry::ToolCall { tool_call_id, .. } if tool_call_id == "b"
        )));
    }
}

// PORT STATUS: src/messages/tool-grouping.ts (269 lines)
// confidence: high
// todos: 0
// notes: §2.5 display side — pure grouping over neutral DisplayContent/
// notes: ToolCategories; no Claude event/JSONL shapes. Reconciled to origin/main
// notes: #419 (84a37888): progress accumulates per parentToolUseId into a Vec of
// notes: ProgressBucket (insertion-ordered so a stable sort_by(insert_index)
// notes: reproduces JS Map iteration + stable Array.sort); collect_explore_run
// notes: ends the run on a parent mismatch; sharedParentToolUseId dropped.
// notes: group_task_children is a two-pass partition — index Tasks, then nest any
// notes: part by parentToolUseId regardless of position (parallel/interleaved),
// notes: untagged stay top-level, unknown-parent tags dropped, a childless Task
// notes: falls back to its bare tool-call. The `'grouped'`/`'accumulated'` markers
// notes: stay &'static str (never read). parentToolUseId truthy check (undefined
// notes: AND "" → omit) preserved via `truthy`/`truthy_str`; the bucket key keeps
// notes: the raw Option so None (main agent) stays distinct from Some("").
// notes: Oracle: __tests__/messages/tool-grouping.test.ts ported assertion-for-
// notes: assertion (+ the AskUserQuestion cases from tool-grouping-askuserquestion).
// notes: display-pipeline.test.ts exercises prepare_messages_for_client, which the
// notes: crate-layering split homes in mainframe-adapter-claude::messages::
// notes: display_pipeline (outside this crate) — ported there, not here.
