use super::*;

fn suggestion(icon: &str, tint: SuggestionTint, title: &str) -> Suggestion {
    Suggestion {
        icon: icon.to_string(),
        tint,
        title: title.to_string(),
        meta: String::new(),
        prefill: "p".to_string(),
    }
}

#[test]
fn emits_a_working_changes_suggestion_when_the_tree_is_dirty() {
    let out = build_churn_suggestions(&ChurnInput {
        branch: Some("main".to_string()),
        base_branch: Some("main".to_string()),
        working_file_count: 3,
        branch_diff_count: 0,
    });
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].icon, "git-compare");
    assert_eq!(out[0].tint, SuggestionTint::Accent);
    assert_eq!(out[0].title, "Review the working changes");
    assert_eq!(out[0].meta, "git · 3 files uncommitted");
    assert_eq!(
        out[0].prefill,
        "Review the uncommitted changes in the working tree, summarize what they do, and flag anything unsafe to commit."
    );
}

#[test]
fn emits_a_branch_churn_suggestion_when_the_branch_diverges_from_its_base() {
    let out = build_churn_suggestions(&ChurnInput {
        branch: Some("feat/x".to_string()),
        base_branch: Some("main".to_string()),
        working_file_count: 0,
        branch_diff_count: 5,
    });
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].icon, "git-branch");
    assert_eq!(out[0].tint, SuggestionTint::Accent);
    assert_eq!(out[0].title, "Summarize what changed on feat/x");
    assert_eq!(out[0].meta, "git · 5 files vs main");
    assert_eq!(
        out[0].prefill,
        "Summarize the changes on the `feat/x` branch compared to `main`."
    );
}

#[test]
fn emits_working_changes_first_then_branch_churn_when_both_apply() {
    let out = build_churn_suggestions(&ChurnInput {
        branch: Some("feat/x".to_string()),
        base_branch: Some("main".to_string()),
        working_file_count: 2,
        branch_diff_count: 4,
    });
    let titles: Vec<&str> = out.iter().map(|s| s.title.as_str()).collect();
    assert_eq!(
        titles,
        vec![
            "Review the working changes",
            "Summarize what changed on feat/x"
        ]
    );
}

#[test]
fn returns_empty_on_a_clean_repo_with_no_divergence() {
    let out = build_churn_suggestions(&ChurnInput {
        branch: Some("main".to_string()),
        base_branch: Some("main".to_string()),
        working_file_count: 0,
        branch_diff_count: 0,
    });
    assert!(out.is_empty());
}

#[test]
fn does_not_emit_branch_churn_when_there_is_no_base_branch() {
    let out = build_churn_suggestions(&ChurnInput {
        branch: Some("feat/x".to_string()),
        base_branch: None,
        working_file_count: 0,
        branch_diff_count: 3,
    });
    assert!(out.is_empty());
}

#[test]
fn singularizes_file_in_the_working_changes_meta_when_there_is_exactly_1() {
    let out = build_churn_suggestions(&ChurnInput {
        branch: Some("main".to_string()),
        base_branch: Some("main".to_string()),
        working_file_count: 1,
        branch_diff_count: 0,
    });
    assert_eq!(out[0].meta, "git · 1 file uncommitted");
}

#[test]
fn singularizes_file_in_the_branch_churn_meta_when_there_is_exactly_1() {
    let out = build_churn_suggestions(&ChurnInput {
        branch: Some("feat/x".to_string()),
        base_branch: Some("main".to_string()),
        working_file_count: 0,
        branch_diff_count: 1,
    });
    assert_eq!(out[0].meta, "git · 1 file vs main");
}

#[test]
fn groups_matches_by_top_level_dir_and_reports_the_largest_area() {
    let matches = vec![
        "src/a.ts".to_string(),
        "src/b.ts".to_string(),
        "src/c.ts".to_string(),
        "docs/x.md".to_string(),
    ];
    let out = build_todo_suggestions(&matches);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].icon, "list-checks");
    assert_eq!(out[0].tint, SuggestionTint::Amber);
    assert_eq!(out[0].title, "Clean up the 3 TODO comments in src");
    assert_eq!(out[0].meta, "code · 3 matches");
    assert_eq!(
        out[0].prefill,
        "Find and address the TODO/FIXME comments in `src`."
    );
}

#[test]
fn uses_a_root_file_bucket_label_when_a_match_is_at_the_repo_root() {
    let out = build_todo_suggestions(&["README.md".to_string()]);
    assert_eq!(
        out[0].title,
        "Clean up the 1 TODO comments in the project root"
    );
}

#[test]
fn returns_empty_for_no_matches() {
    assert!(build_todo_suggestions(&[]).is_empty());
}

#[test]
fn keeps_churn_first_then_todos_capped_at_3() {
    let churn = vec![
        suggestion("a", SuggestionTint::Accent, "c1"),
        suggestion("b", SuggestionTint::Accent, "c2"),
    ];
    let todos = vec![
        suggestion("c", SuggestionTint::Amber, "t1"),
        suggestion("d", SuggestionTint::Amber, "t2"),
    ];
    let titles: Vec<String> = merge_suggestions(churn, todos)
        .into_iter()
        .map(|s| s.title)
        .collect();
    assert_eq!(titles, vec!["c1", "c2", "t1"]);
}
