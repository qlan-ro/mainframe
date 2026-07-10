//! Ported from `packages/core/src/messages/tool-grouping.ts`.
//!
//! Adapter-agnostic (§2.5 display side): post-processes a flat `PartEntry` list
//! into virtual group wrappers — explore runs collapse into `_tool_group`,
//! hidden tools are dropped, task-progress tools accumulate into a single
//! `_task_progress`, and subagent children nest under a `_task_group`. Operates
//! only on the neutral `DisplayContent`/`ToolCategories` types; no Claude shapes.

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

/// All task-progress tools accumulated into a single progress feed entry.
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

/// Returns a `parentToolUseId` only if every item shares the same non-empty
/// value. Used to propagate the tag onto virtual wrappers (`_tool_group`,
/// `_task_progress`) so `group_task_children` can match them.
fn shared_parent_tool_use_id(parents: &[Option<String>]) -> Option<String> {
    let first = match parents.first().and_then(|p| p.as_deref()) {
        Some(f) if !f.is_empty() => f,
        _ => return None,
    };
    if parents.iter().all(|p| p.as_deref() == Some(first)) {
        Some(first.to_string())
    } else {
        None
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

/// Accumulate a progress tool into the single `_task_progress` entry, anchoring
/// its insert position at the first one seen (shared by the main loop and the
/// explore look-ahead, mirroring the TS `collectTaskItem` closure).
fn collect_task_item(
    task_items: &mut Vec<TaskProgressItem>,
    task_insert_index: &mut i64,
    result_len: usize,
    tc: &ToolCallRef<'_>,
) {
    if *task_insert_index == -1 {
        *task_insert_index = result_len as i64;
    }
    task_items.push(TaskProgressItem {
        tool_call_id: tc.tool_call_id.to_string(),
        tool_name: tc.tool_name.to_string(),
        args: tc.args.clone(),
        result: tc.result.clone(),
        is_error: tc.is_error,
        parent_tool_use_id: truthy(tc.parent_tool_use_id),
    });
}

/// Post-processes parts to group consecutive explore tools, suppress hidden
/// tools, and accumulate task-progress tools into a single `_task_progress`
/// entry. Categories are adapter-declared — pass the adapter's `ToolCategories`.
pub fn group_tool_call_parts(parts: &[PartEntry], categories: &ToolCategories) -> Vec<PartEntry> {
    let mut result: Vec<PartEntry> = Vec::new();
    let mut task_items: Vec<TaskProgressItem> = Vec::new();
    let mut task_insert_index: i64 = -1;
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
        // single _TaskProgress entry). Progress must win, or they'd be dropped.
        if is_task_progress_tool(tc.tool_name, categories) {
            collect_task_item(&mut task_items, &mut task_insert_index, result.len(), &tc);
            i += 1;
            continue;
        }

        // Skip hidden tools
        if is_hidden_tool_part(tc.tool_name, tc.category, categories) {
            i += 1;
            continue;
        }

        // Collect consecutive explore tools into a group
        if is_explore_tool(tc.tool_name, categories) {
            let mut group: Vec<ToolGroupItem> = vec![tool_group_item_from(&tc)];
            let mut j = i + 1;
            while j < parts.len() {
                let next = match parts[j].as_tool_call() {
                    Some(next) => next,
                    None => break,
                };
                if is_explore_tool(next.tool_name, categories) {
                    group.push(tool_group_item_from(&next));
                } else if is_task_progress_tool(next.tool_name, categories) {
                    // A progress tool inside the run is accumulated, not dropped.
                    collect_task_item(&mut task_items, &mut task_insert_index, result.len(), &next);
                } else if !is_hidden_tool_part(next.tool_name, next.category, categories) {
                    break;
                }
                // hidden tools within the run are skipped
                j += 1;
            }

            if group.len() >= 2 {
                let parents: Vec<Option<String>> =
                    group.iter().map(|g| g.parent_tool_use_id.clone()).collect();
                let wrapper_parent = shared_parent_tool_use_id(&parents);
                result.push(PartEntry::ToolGroup(ToolGroupEntry {
                    tool_call_id: group[0].tool_call_id.clone(),
                    items: group,
                    result: "grouped",
                    parent_tool_use_id: wrapper_parent,
                }));
            } else {
                // group.length === 1 → push the original part unchanged.
                result.push(part.clone());
            }
            i = j;
            continue;
        }

        // Everything else passes through
        result.push(part.clone());
        i += 1;
    }

    // Insert accumulated task progress at the position of the first task tool
    if !task_items.is_empty() {
        let parents: Vec<Option<String>> = task_items
            .iter()
            .map(|it| it.parent_tool_use_id.clone())
            .collect();
        let wrapper_parent = shared_parent_tool_use_id(&parents);
        let first_id = task_items[0].tool_call_id.clone();
        let entry = PartEntry::TaskProgress(TaskProgressEntry {
            tool_call_id: first_id,
            items: task_items,
            result: "accumulated",
            parent_tool_use_id: wrapper_parent,
        });
        let index = if task_insert_index >= 0 {
            task_insert_index as usize
        } else {
            result.len()
        };
        result.insert(index, entry);
    }

    result
}

/// Wraps a subagent tool call together with all subsequent parts tagged with a
/// matching `parentToolUseId` into a single `_task_group` virtual entry so they
/// render nested under the subagent header. Stops as soon as a part carries no
/// tag or a different one. Categories are adapter-declared.
pub fn group_task_children(parts: &[PartEntry], categories: &ToolCategories) -> Vec<PartEntry> {
    let mut result: Vec<PartEntry> = Vec::new();
    let mut i = 0usize;

    while i < parts.len() {
        let part = &parts[i];

        let subagent = match part.as_tool_call() {
            Some(tc) if is_subagent_tool(tc.tool_name, categories) => Some((
                tc.tool_call_id.to_string(),
                tc.args.clone(),
                tc.result.clone(),
                tc.is_error,
            )),
            _ => None,
        };

        if let Some((agent_tool_use_id, task_args, task_result, task_is_error)) = subagent {
            let mut children: Vec<PartEntry> = Vec::new();
            let mut j = i + 1;
            while j < parts.len() {
                // Only collect parts tagged as belonging to THIS Agent.
                if parts[j].parent_tool_use_id() != Some(agent_tool_use_id.as_str()) {
                    break;
                }
                children.push(parts[j].clone());
                j += 1;
            }

            if !children.is_empty() {
                result.push(PartEntry::TaskGroup(TaskGroupEntry {
                    tool_call_id: agent_tool_use_id,
                    task_args,
                    children,
                    result: task_result,
                    is_error: task_is_error,
                    parent_tool_use_id: None,
                }));
                i = j;
            } else {
                result.push(part.clone());
                i += 1;
            }
        } else {
            result.push(part.clone());
            i += 1;
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn cats() -> ToolCategories {
        ToolCategories {
            explore: HashSet::from([
                "Read".to_string(),
                "Grep".to_string(),
                "Glob".to_string(),
                "LS".to_string(),
            ]),
            hidden: HashSet::from(["HiddenTool".to_string(), "TodoWrite".to_string()]),
            progress: HashSet::from(["TodoWrite".to_string()]),
            subagent: HashSet::from(["Task".to_string(), "Agent".to_string()]),
        }
    }

    fn tool_call(id: &str, name: &str, category: Option<&str>) -> PartEntry {
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

    fn tool_call_child(id: &str, name: &str, parent: &str) -> PartEntry {
        PartEntry::ToolCall {
            tool_call_id: id.to_string(),
            tool_name: name.to_string(),
            args: HashMap::new(),
            result: None,
            is_error: None,
            category: None,
            parent_tool_use_id: Some(parent.to_string()),
        }
    }

    fn thinking() -> PartEntry {
        PartEntry::Passthrough {
            content: DisplayContent::Leaf(mainframe_types::content::LeafContent::Thinking {
                thinking: "t".to_string(),
                parent_tool_use_id: None,
            }),
            parent_tool_use_id: None,
        }
    }

    fn group_ids(part: &PartEntry) -> Vec<String> {
        match part {
            PartEntry::ToolGroup(e) => e.items.iter().map(|i| i.tool_call_id.clone()).collect(),
            _ => Vec::new(),
        }
    }

    // ── AskUserQuestion (ported from tool-grouping-askuserquestion.test.ts) ──
    fn auq_cats() -> ToolCategories {
        ToolCategories {
            explore: HashSet::new(),
            hidden: HashSet::from(["AskUserQuestion".to_string()]),
            progress: HashSet::new(),
            subagent: HashSet::new(),
        }
    }

    #[test]
    fn keeps_an_answered_default_ask_user_question_part() {
        let out = group_tool_call_parts(
            &[tool_call("a", "AskUserQuestion", Some("default"))],
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
            &[tool_call("b", "AskUserQuestion", Some("hidden"))],
            &auq_cats(),
        );
        assert!(!out.iter().any(|p| matches!(
            p,
            PartEntry::ToolCall { tool_call_id, .. } if tool_call_id == "b"
        )));
    }

    // ── Explore grouping (derived from apply-tool-grouping-characterization) ──
    #[test]
    fn a_single_explore_tool_is_not_wrapped() {
        let out = group_tool_call_parts(&[tool_call("tc1", "Read", Some("explore"))], &cats());
        assert_eq!(out.len(), 1);
        assert!(matches!(out[0], PartEntry::ToolCall { .. }));
    }

    #[test]
    fn two_consecutive_explore_tools_are_wrapped() {
        let out = group_tool_call_parts(
            &[
                tool_call("e1", "Read", Some("explore")),
                tool_call("e2", "Grep", Some("explore")),
            ],
            &cats(),
        );
        assert_eq!(out.len(), 1);
        assert_eq!(group_ids(&out[0]), vec!["e1".to_string(), "e2".to_string()]);
    }

    #[test]
    fn non_groupable_breaks_the_explore_run() {
        // explore → thinking → explore → explore: tc1 solo, thinking stays,
        // tc2+tc3 group. Look-ahead only spans consecutive tool-calls.
        let out = group_tool_call_parts(
            &[
                tool_call("tc1", "Read", Some("explore")),
                thinking(),
                tool_call("tc2", "Grep", Some("explore")),
                tool_call("tc3", "LS", Some("explore")),
            ],
            &cats(),
        );
        assert_eq!(out.len(), 3);
        assert!(
            matches!(&out[0], PartEntry::ToolCall { tool_call_id, .. } if tool_call_id == "tc1")
        );
        assert!(matches!(out[1], PartEntry::Passthrough { .. }));
        assert_eq!(
            group_ids(&out[2]),
            vec!["tc2".to_string(), "tc3".to_string()]
        );
    }

    #[test]
    fn default_tool_splits_two_explore_groups() {
        let out = group_tool_call_parts(
            &[
                tool_call("e1", "Read", Some("explore")),
                tool_call("e2", "Grep", Some("explore")),
                tool_call("w1", "Write", Some("default")),
                tool_call("e3", "Read", Some("explore")),
                tool_call("e4", "LS", Some("explore")),
            ],
            &cats(),
        );
        assert_eq!(out.len(), 3);
        assert_eq!(group_ids(&out[0]), vec!["e1".to_string(), "e2".to_string()]);
        assert!(
            matches!(&out[1], PartEntry::ToolCall { tool_call_id, .. } if tool_call_id == "w1")
        );
        assert_eq!(group_ids(&out[2]), vec!["e3".to_string(), "e4".to_string()]);
    }

    // ── Task-progress accumulation ──
    #[test]
    fn progress_tools_accumulate_at_first_seen_position() {
        // TodoWrite is both hidden and progress → progress wins. Both accumulate
        // into one _task_progress spliced at the first progress tool's slot.
        let out = group_tool_call_parts(
            &[
                tool_call("t1", "Write", Some("default")),
                tool_call("tp1", "TodoWrite", Some("progress")),
                tool_call("t2", "Write", Some("default")),
                tool_call("tp2", "TodoWrite", Some("progress")),
            ],
            &cats(),
        );
        assert_eq!(out.len(), 3);
        // slot 0: Write t1; slot 1: the accumulated _task_progress; slot 2: Write t2
        assert!(
            matches!(&out[0], PartEntry::ToolCall { tool_call_id, .. } if tool_call_id == "t1")
        );
        match &out[1] {
            PartEntry::TaskProgress(e) => {
                let got: Vec<String> = e.items.iter().map(|i| i.tool_call_id.clone()).collect();
                assert_eq!(got, vec!["tp1".to_string(), "tp2".to_string()]);
            }
            other => panic!("expected _task_progress at slot 1, got {other:?}"),
        }
        assert!(
            matches!(&out[2], PartEntry::ToolCall { tool_call_id, .. } if tool_call_id == "t2")
        );
    }

    // ── Subagent nesting (group_task_children) ──
    #[test]
    fn subagent_wraps_only_matching_tagged_children() {
        let parts = vec![
            tool_call("agent1", "Task", None),
            tool_call_child("c1", "Read", "agent1"),
            tool_call_child("c2", "Grep", "agent1"),
            tool_call("after", "Write", Some("default")), // untagged → stops the run
        ];
        let out = group_task_children(&parts, &cats());
        assert_eq!(out.len(), 2);
        match &out[0] {
            PartEntry::TaskGroup(e) => {
                assert_eq!(e.tool_call_id, "agent1");
                assert_eq!(e.children.len(), 2);
            }
            other => panic!("expected _task_group, got {other:?}"),
        }
        assert!(
            matches!(&out[1], PartEntry::ToolCall { tool_call_id, .. } if tool_call_id == "after")
        );
    }

    #[test]
    fn subagent_with_no_tagged_children_passes_through() {
        let parts = vec![
            tool_call("agent1", "Task", None),
            tool_call("other", "Write", Some("default")),
        ];
        let out = group_task_children(&parts, &cats());
        assert_eq!(out.len(), 2);
        assert!(
            matches!(&out[0], PartEntry::ToolCall { tool_call_id, .. } if tool_call_id == "agent1")
        );
    }
}

// PORT STATUS: src/messages/tool-grouping.ts (248 lines)
// confidence: high
// todos: 0
// notes: §2.5 display side — pure grouping over neutral DisplayContent/
// notes: ToolCategories; no Claude event/JSONL shapes. The TS discriminated
// notes: PartEntry union → a Rust enum; the named interfaces (ToolGroupEntry/
// notes: TaskGroupEntry/TaskProgressEntry) are nested structs. `result: unknown`
// notes: → Option<serde_json::Value> (grouping never inspects it, only carries).
// notes: The `'grouped'`/`'accumulated'` literal markers kept as &'static str for
// notes: structural fidelity (never read downstream). `parentToolUseId` truthy
// notes: check (undefined AND "" → omit) preserved via `truthy`. splice(idx,0,e)
// notes: → Vec::insert. Recently-fixed contiguity + progress-accumulation +
// notes: subagent-tagging behavior locked by unit tests; applyToolGrouping's own
// notes: characterization tests port with display-helpers into adapter-claude
// notes: (see the display_helpers/display_pipeline layering blocker).
