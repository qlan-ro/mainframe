use std::collections::HashMap;

use mainframe_types::suggestion::{Suggestion, SuggestionTint};

const MAX_SUGGESTIONS: usize = 3;

/// Cheap git signals gathered by the route.
pub struct ChurnInput {
    pub branch: Option<String>,
    pub base_branch: Option<String>,
    pub working_file_count: i64,
    pub branch_diff_count: i64,
}

/// Derive up-to-two "churn" suggestions from cheap git signals: the dirty
/// working tree (accent) and, when the branch diverges from its detected base,
/// a branch summary (accent). Pure — the route gathers the counts via GitService.
pub(crate) fn build_churn_suggestions(input: &ChurnInput) -> Vec<Suggestion> {
    let mut out = Vec::new();

    if input.working_file_count > 0 {
        let plural = if input.working_file_count == 1 {
            ""
        } else {
            "s"
        };
        out.push(Suggestion {
            icon: "git-compare".to_string(),
            tint: SuggestionTint::Accent,
            title: "Review the working changes".to_string(),
            meta: format!("git · {} file{plural} uncommitted", input.working_file_count),
            prefill: "Review the uncommitted changes in the working tree, summarize what they do, and flag anything unsafe to commit.".to_string(),
        });
    }

    if let (Some(branch), Some(base_branch)) = (&input.branch, &input.base_branch)
        && branch != base_branch
        && input.branch_diff_count > 0
    {
        let plural = if input.branch_diff_count == 1 {
            ""
        } else {
            "s"
        };
        out.push(Suggestion {
            icon: "git-branch".to_string(),
            tint: SuggestionTint::Accent,
            title: format!("Summarize what changed on {branch}"),
            meta: format!(
                "git · {} file{plural} vs {base_branch}",
                input.branch_diff_count
            ),
            prefill: format!(
                "Summarize the changes on the `{branch}` branch compared to `{base_branch}`."
            ),
        });
    }

    out
}

/// First path segment, or a root sentinel for a repo-root file.
fn top_area(file: &str) -> &str {
    match file.find('/') {
        Some(idx) => &file[..idx],
        None => "the project root",
    }
}

/// One amber suggestion for the directory holding the most TODO/FIXME matches.
/// `matches` come from a bounded ripgrep pass in the route (already
/// path-contained).
pub(crate) fn build_todo_suggestions(matches: &[String]) -> Vec<Suggestion> {
    if matches.is_empty() {
        return Vec::new();
    }

    let mut counts: HashMap<&str, i64> = HashMap::new();
    // Insertion order matters for a stable "largest area" tie-break: the
    // first-seen area wins ties.
    let mut order: Vec<&str> = Vec::new();
    for m in matches {
        let area = top_area(m);
        if !counts.contains_key(area) {
            order.push(area);
        }
        *counts.entry(area).or_insert(0) += 1;
    }

    let mut best_area = "";
    let mut best_count = 0;
    for area in order {
        let count = counts[area];
        if count > best_count {
            best_area = area;
            best_count = count;
        }
    }

    vec![Suggestion {
        icon: "list-checks".to_string(),
        tint: SuggestionTint::Amber,
        title: format!("Clean up the {best_count} TODO comments in {best_area}"),
        meta: format!("code · {best_count} matches"),
        prefill: format!("Find and address the TODO/FIXME comments in `{best_area}`."),
    }]
}

/// Churn first, then todos, capped to at most 3.
pub(crate) fn merge_suggestions(churn: Vec<Suggestion>, todos: Vec<Suggestion>) -> Vec<Suggestion> {
    churn
        .into_iter()
        .chain(todos)
        .take(MAX_SUGGESTIONS)
        .collect()
}

#[cfg(test)]
#[path = "build_suggestions_tests.rs"]
mod tests;
