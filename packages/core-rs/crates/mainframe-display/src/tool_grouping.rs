//! Adapter-agnostic: post-processes a flat `PartEntry` list
//! into virtual group wrappers — explore runs collapse into `_tool_group`,
//! hidden tools are dropped, task-progress tools accumulate into one
//! `_task_progress` per parent, and subagent children nest under a `_task_group`.
//! Operates only on the neutral `DisplayContent`/`ToolCategories` types; no
//! Claude shapes.

use std::collections::HashMap;

use mainframe_types::display::{DisplayContent, ToolCategories, ToolCategory};
use serde_json::Value;

use crate::display_helpers::with_parent_id;
use crate::hidden_boundary::{HiddenBoundary, paragraph_break};
use crate::tool_categorization::{
    is_explore_tool, is_hidden_tool_part, is_subagent_tool, is_task_progress_tool,
};

/// One tool call collected into an explore group or a task-progress feed.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ToolGroupItem {
    pub(crate) tool_name: String,
    pub(crate) tool_call_id: String,
    pub(crate) args: HashMap<String, Value>,
    pub(crate) parent_tool_use_id: Option<String>,
}

/// Consecutive explore tools collapsed into one expandable group card.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ToolGroupEntry {
    pub(crate) tool_call_id: String,
    pub(crate) items: Vec<ToolGroupItem>,
    pub(crate) parent_tool_use_id: Option<String>,
}

/// A subagent (Task) tool plus every part tagged with its tool_use id.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TaskGroupEntry {
    pub(crate) tool_call_id: String,
    pub(crate) task_args: HashMap<String, Value>,
    pub(crate) children: Vec<PartEntry>,
}

/// Task-progress tools accumulated into one progress feed entry per parent.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TaskProgressEntry {
    pub(crate) tool_call_id: String,
    pub(crate) items: Vec<ToolGroupItem>,
    pub(crate) parent_tool_use_id: Option<String>,
}

/// A tool call's result is not carried here: the display conversion
/// re-reads it from the original content by tool call id.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum PartEntry {
    ToolCall {
        tool_call_id: String,
        tool_name: String,
        args: HashMap<String, Value>,
        category: Option<ToolCategory>,
        parent_tool_use_id: Option<String>,
    },
    Text {
        text: String,
        parent_tool_use_id: Option<String>,
    },
    /// Non-groupable content (thinking, image, …) carried through in-place.
    Passthrough {
        content: Box<DisplayContent>,
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
    category: Option<ToolCategory>,
    parent_tool_use_id: &'a Option<String>,
}

impl PartEntry {
    fn as_tool_call(&self) -> Option<ToolCallRef<'_>> {
        match self {
            PartEntry::ToolCall {
                tool_call_id,
                tool_name,
                args,
                category,
                parent_tool_use_id,
            } => Some(ToolCallRef {
                tool_call_id,
                tool_name,
                args,
                category: *category,
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
            PartEntry::TaskGroup(_) => None,
            PartEntry::TaskProgress(e) => e.parent_tool_use_id.as_deref(),
        }
    }
}

fn group_item_from(tc: &ToolCallRef<'_>) -> ToolGroupItem {
    ToolGroupItem {
        tool_name: tc.tool_name.to_string(),
        tool_call_id: tc.tool_call_id.to_string(),
        args: tc.args.clone(),
        parent_tool_use_id: with_parent_id(tc.parent_tool_use_id),
    }
}

/// One progress feed accumulator per `parentToolUseId` (the raw key — `None` for
/// the main agent, distinct from `Some("")`). `insert_index` anchors the splice
/// position at `result.len()` when the parent's first progress tool is seen.
struct ProgressBucket {
    key: Option<String>,
    insert_index: usize,
    items: Vec<ToolGroupItem>,
}

/// Accumulate a progress tool into its parent's bucket, anchoring the bucket's
/// insert position at the first one seen. Shared by the main loop and the
/// explore look-ahead.
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
    buckets[pos].items.push(group_item_from(tc));
}

/// Post-processes parts to group consecutive explore tools, suppress hidden
/// tools, and accumulate task-progress tools into one `_task_progress` entry per
/// parent. Categories are adapter-declared — pass the adapter's `ToolCategories`.
///
/// A dropped hidden tool call still leaves a paragraph boundary for the text
/// that follows it (`hidden_boundary.rs`) — the encoder itself is
/// unchanged and still concatenates adjacent text leaves with no separator.
pub(crate) fn group_tool_call_parts(
    parts: &[PartEntry],
    categories: &ToolCategories,
) -> Vec<PartEntry> {
    let mut result: Vec<PartEntry> = Vec::new();
    // Progress tools accumulate per parentToolUseId (None = main agent), so a
    // subagent's progress feed stays single-parented and can nest inside its
    // task group instead of merging with the main agent's into one mixed entry.
    let mut buckets: Vec<ProgressBucket> = Vec::new();
    let mut boundary = HiddenBoundary::new();
    let mut i = 0usize;

    while i < parts.len() {
        let part = &parts[i];
        i = match part.as_tool_call() {
            Some(tc) => dispatch_tool_call_part(
                parts,
                i,
                &tc,
                categories,
                &mut result,
                &mut buckets,
                &mut boundary,
            ),
            None => {
                push_non_tool_part(&mut result, &buckets, &mut boundary, part.clone());
                i + 1
            }
        };
    }

    splice_progress_entries(&mut result, buckets);
    result
}

/// Dispatches the `ToolCall` part at `parts[i]`: accumulates a progress tool
/// (checked first — the V2 task tools are both `hidden` and `progress`, and
/// progress must win or they'd be dropped), drops a hidden tool while
/// recording the paragraph boundary its drop leaves behind, collects an
/// explore run, or passes a visible tool call through. Every branch but the
/// hidden drop clears the pending boundary. Returns the index of the next
/// unconsumed part.
fn dispatch_tool_call_part(
    parts: &[PartEntry],
    i: usize,
    tc: &ToolCallRef<'_>,
    categories: &ToolCategories,
    result: &mut Vec<PartEntry>,
    buckets: &mut Vec<ProgressBucket>,
    boundary: &mut HiddenBoundary,
) -> usize {
    if is_task_progress_tool(tc.tool_name, categories) {
        collect_task_item(buckets, result.len(), tc);
        return i + 1;
    }
    if is_hidden_tool_part(tc.tool_name, tc.category, categories) {
        boundary.mark_hidden_drop(tc.parent_tool_use_id.clone());
        return i + 1;
    }
    if is_explore_tool(tc.tool_name, categories) {
        let next = collect_explore_run(parts, i, result, categories, buckets);
        // The run always pushes a visible item, so text on either side is
        // already in separate segments — no boundary needed.
        boundary.clear();
        return next;
    }
    // Everything else passes through
    boundary.clear();
    result.push(parts[i].clone());
    i + 1
}

/// Pushes a non-tool-call part (`Text` or `Passthrough`), applying a pending
/// hidden-call paragraph break to qualifying text first. The break applies
/// only when: a boundary is pending for this text's parent; the last pushed
/// entry is a same-parent, non-whitespace `Text`; and no progress bucket will
/// be spliced at the current position (`splice_progress_entries` already
/// separates that case). An empty incoming text leaves the boundary pending
/// for a later push; every other push clears it.
fn push_non_tool_part(
    result: &mut Vec<PartEntry>,
    buckets: &[ProgressBucket],
    boundary: &mut HiddenBoundary,
    part: PartEntry,
) {
    let PartEntry::Text {
        text,
        parent_tool_use_id,
    } = part
    else {
        boundary.clear();
        result.push(part);
        return;
    };
    if text.is_empty() {
        result.push(PartEntry::Text {
            text,
            parent_tool_use_id,
        });
        return;
    }

    let tail = match result.last() {
        Some(PartEntry::Text {
            text: t,
            parent_tool_use_id: p,
        }) if *p == parent_tool_use_id && !t.trim().is_empty() => Some(t.as_str()),
        _ => None,
    };
    let can_break = boundary.pending_for(&parent_tool_use_id)
        && tail.is_some()
        && !buckets.iter().any(|b| b.insert_index == result.len());

    let text = match (can_break, tail) {
        (true, Some(tail)) => format!("{}{text}", "\n".repeat(paragraph_break(tail, &text))),
        _ => text,
    };

    boundary.clear();
    result.push(PartEntry::Text {
        text,
        parent_tool_use_id,
    });
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
    let mut group: Vec<ToolGroupItem> = vec![group_item_from(&first)];
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
            group.push(group_item_from(&next));
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
            parent_tool_use_id: with_parent_id(&run_parent),
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
/// index keep their first-seen order.
fn splice_progress_entries(result: &mut Vec<PartEntry>, mut buckets: Vec<ProgressBucket>) {
    buckets.sort_by_key(|b| b.insert_index);
    let mut offset = 0usize;
    for bucket in buckets {
        let Some(first_id) = bucket.items.first().map(|it| it.tool_call_id.clone()) else {
            continue;
        };
        let entry = PartEntry::TaskProgress(TaskProgressEntry {
            tool_call_id: first_id,
            parent_tool_use_id: with_parent_id(&bucket.key),
            items: bucket.items,
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
pub(crate) fn group_task_children(
    parts: &[PartEntry],
    categories: &ToolCategories,
) -> Vec<PartEntry> {
    let mut groups: HashMap<String, TaskGroupEntry> = HashMap::new();
    for part in parts {
        if let Some(tc) = part.as_tool_call()
            && with_parent_id(tc.parent_tool_use_id).is_none()
            && is_subagent_tool(tc.tool_name, categories)
        {
            groups.insert(
                tc.tool_call_id.to_string(),
                TaskGroupEntry {
                    tool_call_id: tc.tool_call_id.to_string(),
                    task_args: tc.args.clone(),
                    children: Vec::new(),
                },
            );
        }
    }

    let mut slots: Vec<Slot> = Vec::new();
    for part in parts {
        if let Some(tc) = part.as_tool_call()
            && with_parent_id(tc.parent_tool_use_id).is_none()
            && groups.contains_key(tc.tool_call_id)
        {
            slots.push(Slot::Group(tc.tool_call_id.to_string()));
            continue;
        }
        if let Some(parent) = part.parent_tool_use_id().filter(|id| !id.is_empty()) {
            // An unknown parent (no matching Task in this turn) drops the part.
            if let Some(group) = groups.get_mut(parent) {
                group.children.push(part.clone());
            }
            continue;
        }
        slots.push(Slot::Part(Box::new(part.clone())));
    }

    // A Task always renders as a `_task_group`, even with zero gathered
    // children — the TaskCard handles an empty `children` list. A Task id
    // repeated in one turn renders once, at its first position.
    slots
        .into_iter()
        .filter_map(|slot| match slot {
            Slot::Part(p) => Some(*p),
            Slot::Group(id) => groups.remove(&id).map(PartEntry::TaskGroup),
        })
        .collect()
}

#[cfg(test)]
#[path = "tool_grouping_tests.rs"]
mod tests;
