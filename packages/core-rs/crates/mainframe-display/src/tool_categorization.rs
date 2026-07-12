//! Ported from `packages/core/src/messages/tool-categorization.ts`.
//!
//! Adapter-declared tool categorization. Adapter-agnostic: operates purely on the
//! neutral `ToolCategories` sets from `mainframe-types` (§2.5 display side).

use mainframe_types::display::ToolCategories;

pub fn is_explore_tool(name: &str, categories: &ToolCategories) -> bool {
    categories.explore.contains(name)
}

pub fn is_hidden_tool(name: &str, categories: &ToolCategories) -> bool {
    categories.hidden.contains(name)
}

pub fn is_hidden_tool_part(
    name: &str,
    category: Option<&str>,
    categories: &ToolCategories,
) -> bool {
    if name == "AskUserQuestion"
        && let Some(category) = category
    {
        return category == "hidden";
    }
    is_hidden_tool(name, categories)
}

pub fn is_task_progress_tool(name: &str, categories: &ToolCategories) -> bool {
    categories.progress.contains(name)
}

pub fn is_subagent_tool(name: &str, categories: &ToolCategories) -> bool {
    categories.subagent.contains(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn categories() -> ToolCategories {
        ToolCategories {
            explore: HashSet::from(["Read".to_string(), "Grep".to_string()]),
            hidden: HashSet::from(["HiddenTool".to_string(), "AskUserQuestion".to_string()]),
            progress: HashSet::from(["TaskCreate".to_string()]),
            subagent: HashSet::from(["Task".to_string()]),
        }
    }

    #[test]
    fn membership_predicates() {
        let c = categories();
        assert!(is_explore_tool("Read", &c));
        assert!(!is_explore_tool("Write", &c));
        assert!(is_hidden_tool("HiddenTool", &c));
        assert!(!is_hidden_tool("Read", &c));
        assert!(is_task_progress_tool("TaskCreate", &c));
        assert!(!is_task_progress_tool("Read", &c));
        assert!(is_subagent_tool("Task", &c));
        assert!(!is_subagent_tool("Read", &c));
    }

    #[test]
    fn ask_user_question_part_honors_category_override() {
        let c = categories();
        // AskUserQuestion with an explicit category resolves by that category,
        // not by the hidden set.
        assert!(is_hidden_tool_part("AskUserQuestion", Some("hidden"), &c));
        assert!(!is_hidden_tool_part("AskUserQuestion", Some("default"), &c));
        // Without a category, falls back to the hidden set (AskUserQuestion ∈ hidden).
        assert!(is_hidden_tool_part("AskUserQuestion", None, &c));
        // Other tools ignore the category argument and use the hidden set.
        assert!(is_hidden_tool_part("HiddenTool", Some("default"), &c));
        assert!(!is_hidden_tool_part("Read", Some("hidden"), &c));
    }
}

// PORT STATUS: src/messages/tool-categorization.ts (22 lines)
// confidence: high
// todos: 0
// notes: lands on the mainframe-display side of the §2.5 split — operates only on
// notes: the neutral ToolCategories sets, no Claude event/JSONL shapes. TS `Set.has`
// notes: → `HashSet::contains`. `category` param is Option<&str> (TS `string |
// notes: undefined`). All five predicates are pub (tool-grouping imports
// notes: is_hidden_tool_part; index.ts re-exports the other four).
