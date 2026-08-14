//! Ported assertion-for-assertion from `mainframe-adapter-claude::pr_detection`'s
//! `mod tests` (todo #339 task 2) — the pure parser now lives in
//! `mainframe-adapter-api::pr_detection`.

use mainframe_adapter_api::pr_detection::*;

// The TS `REGEX.test(x)` boolean checks map to `parse_*(x).is_some()`.
#[test]
fn pr_url_regex_matches_standard_github_pr_url() {
    assert!(parse_pr_url("https://github.com/owner/repo/pull/123").is_some());
}

#[test]
fn pr_url_regex_does_not_match_non_pr_github_url() {
    assert!(parse_pr_url("https://github.com/owner/repo/issues/123").is_none());
    assert!(parse_pr_url("https://github.com/owner/repo").is_none());
    assert!(parse_pr_url("https://example.com/pull/123").is_none());
}

#[test]
fn pr_url_regex_matches_embedded_url() {
    assert!(
        parse_pr_url("Pull request created at https://github.com/foo/bar/pull/42 — done!")
            .is_some()
    );
}

#[test]
fn azure_pr_url_regex_matches() {
    assert!(
        parse_azure_pr_url("https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/42")
            .is_some()
    );
}

#[test]
fn azure_pr_url_regex_does_not_match_other_azure_urls() {
    assert!(
        parse_azure_pr_url("https://dev.azure.com/myorg/myproject/_git/myrepo/commit/abc")
            .is_none()
    );
    assert!(parse_azure_pr_url("https://dev.azure.com/myorg").is_none());
}

#[test]
fn parse_pr_url_parses_valid_url() {
    assert_eq!(
        parse_pr_url("https://github.com/acme/my-repo/pull/456"),
        Some(DetectedPrCore {
            url: "https://github.com/acme/my-repo/pull/456".to_string(),
            owner: "acme".to_string(),
            repo: "my-repo".to_string(),
            number: 456,
        })
    );
}

#[test]
fn parse_pr_url_returns_none_for_non_matching() {
    assert!(parse_pr_url("https://github.com/owner/repo/issues/10").is_none());
    assert!(parse_pr_url("no URL here").is_none());
}

#[test]
fn parse_pr_url_extracts_first_when_multiple() {
    let result =
        parse_pr_url("https://github.com/org/alpha/pull/1 and https://github.com/org/beta/pull/2")
            .unwrap();
    assert_eq!(result.repo, "alpha");
    assert_eq!(result.number, 1);
}

#[test]
fn parse_azure_pr_url_parses() {
    assert_eq!(
        parse_azure_pr_url("https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/42"),
        Some(DetectedPrCore {
            url: "https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/42".to_string(),
            owner: "myorg".to_string(),
            repo: "myrepo".to_string(),
            number: 42,
        })
    );
}

#[test]
fn parse_azure_pr_url_returns_none_for_non_matching() {
    assert!(parse_azure_pr_url("https://github.com/owner/repo/pull/1").is_none());
    assert!(parse_azure_pr_url("no URL here").is_none());
}

#[test]
fn gitlab_mr_url_regex_matches() {
    assert!(parse_gitlab_mr_url("https://gitlab.com/mygroup/myrepo/-/merge_requests/42").is_some());
}

#[test]
fn gitlab_mr_url_regex_does_not_match_other_gitlab_urls() {
    assert!(parse_gitlab_mr_url("https://gitlab.com/mygroup/myrepo/-/issues/1").is_none());
    assert!(parse_gitlab_mr_url("https://gitlab.com/mygroup").is_none());
}

#[test]
fn parse_gitlab_mr_url_parses() {
    assert_eq!(
        parse_gitlab_mr_url("https://gitlab.com/acme/backend/-/merge_requests/99"),
        Some(DetectedPrCore {
            url: "https://gitlab.com/acme/backend/-/merge_requests/99".to_string(),
            owner: "acme".to_string(),
            repo: "backend".to_string(),
            number: 99,
        })
    );
}

#[test]
fn parse_gitlab_mr_url_returns_none_for_non_matching() {
    assert!(parse_gitlab_mr_url("https://github.com/owner/repo/pull/1").is_none());
    assert!(parse_gitlab_mr_url("no URL here").is_none());
}

#[test]
fn extract_pr_from_tool_result_github() {
    assert_eq!(
        extract_pr_from_tool_result("Created https://github.com/acme/repo/pull/7"),
        Some(DetectedPrCore {
            url: "https://github.com/acme/repo/pull/7".to_string(),
            owner: "acme".to_string(),
            repo: "repo".to_string(),
            number: 7,
        })
    );
}

#[test]
fn extract_pr_from_tool_result_gitlab() {
    assert_eq!(
        extract_pr_from_tool_result("Created https://gitlab.com/acme/backend/-/merge_requests/99"),
        Some(DetectedPrCore {
            url: "https://gitlab.com/acme/backend/-/merge_requests/99".to_string(),
            owner: "acme".to_string(),
            repo: "backend".to_string(),
            number: 99,
        })
    );
}

#[test]
fn extract_pr_from_tool_result_azure() {
    assert_eq!(
        extract_pr_from_tool_result("https://dev.azure.com/myorg/proj/_git/myrepo/pullrequest/5"),
        Some(DetectedPrCore {
            url: "https://dev.azure.com/myorg/proj/_git/myrepo/pullrequest/5".to_string(),
            owner: "myorg".to_string(),
            repo: "myrepo".to_string(),
            number: 5,
        })
    );
}

#[test]
fn extract_pr_from_tool_result_returns_none_without_url() {
    assert!(extract_pr_from_tool_result("just some output").is_none());
}

#[test]
fn is_pr_mutation_command_matches_gh_mutations() {
    assert!(is_pr_mutation_command("gh pr edit 42 --title \"new\""));
    assert!(is_pr_mutation_command("gh pr ready 42"));
    assert!(is_pr_mutation_command("gh pr merge 42 --squash"));
    assert!(is_pr_mutation_command("gh pr close 42"));
    assert!(is_pr_mutation_command("gh pr reopen 42"));
    assert!(is_pr_mutation_command("gh pr comment 42 --body \"hi\""));
    assert!(is_pr_mutation_command("gh pr review 42 --approve"));
}

#[test]
fn is_pr_mutation_command_matches_glab_mutations() {
    assert!(is_pr_mutation_command("glab mr update 7 --title \"new\""));
    assert!(is_pr_mutation_command("glab mr merge 7"));
    assert!(is_pr_mutation_command("glab mr close 7"));
    assert!(is_pr_mutation_command("glab mr reopen 7"));
    assert!(is_pr_mutation_command("glab mr note 7 --message \"hi\""));
}

#[test]
fn is_pr_mutation_command_matches_az_repos_pr_update() {
    assert!(is_pr_mutation_command(
        "az repos pr update --id 5 --status completed"
    ));
}

#[test]
fn is_pr_mutation_command_does_not_match_read_only_or_create() {
    assert!(!is_pr_mutation_command("gh pr view 42"));
    assert!(!is_pr_mutation_command("gh pr list"));
    assert!(!is_pr_mutation_command("gh pr create --title \"x\""));
    assert!(!is_pr_mutation_command("gh pr checkout 42"));
    assert!(!is_pr_mutation_command("gh pr diff 42"));
    assert!(!is_pr_mutation_command("gh pr status"));
    assert!(!is_pr_mutation_command("glab mr list"));
    assert!(!is_pr_mutation_command("glab mr view 7"));
    assert!(!is_pr_mutation_command("glab mr create"));
    assert!(!is_pr_mutation_command("git push"));
    // word-boundary match; acceptable — rare false positive
    assert!(is_pr_mutation_command("echo gh pr edit 42"));
}

#[test]
fn parse_pr_identifier_from_args_github_url() {
    assert_eq!(
        parse_pr_identifier_from_args(
            "gh pr edit https://github.com/org/repo/pull/42 --add-label bug"
        ),
        Some(DetectedPrCore {
            url: "https://github.com/org/repo/pull/42".to_string(),
            owner: "org".to_string(),
            repo: "repo".to_string(),
            number: 42,
        })
    );
}

#[test]
fn parse_pr_identifier_from_args_gitlab_url() {
    assert_eq!(
        parse_pr_identifier_from_args(
            "glab mr update https://gitlab.com/org/repo/-/merge_requests/7"
        ),
        Some(DetectedPrCore {
            url: "https://gitlab.com/org/repo/-/merge_requests/7".to_string(),
            owner: "org".to_string(),
            repo: "repo".to_string(),
            number: 7,
        })
    );
}

#[test]
fn parse_pr_identifier_from_args_azure_url() {
    assert_eq!(
        parse_pr_identifier_from_args(
            "az repos pr update https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/5"
        ),
        Some(DetectedPrCore {
            url: "https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/5".to_string(),
            owner: "myorg".to_string(),
            repo: "myrepo".to_string(),
            number: 5,
        })
    );
}

#[test]
fn parse_pr_identifier_from_args_gh_compact() {
    assert_eq!(
        parse_pr_identifier_from_args("gh pr ready org/repo#42"),
        Some(DetectedPrCore {
            url: "https://github.com/org/repo/pull/42".to_string(),
            owner: "org".to_string(),
            repo: "repo".to_string(),
            number: 42,
        })
    );
}

#[test]
fn parse_pr_identifier_from_args_returns_none_without_identifier() {
    assert!(parse_pr_identifier_from_args("gh pr edit 42 --title x").is_none());
    assert!(parse_pr_identifier_from_args("gh pr edit").is_none());
    assert!(parse_pr_identifier_from_args("az repos pr update --id 5").is_none());
}

#[test]
fn parse_pr_identifier_from_args_rejects_compact_for_non_gh() {
    assert!(parse_pr_identifier_from_args("glab mr update org/repo#42").is_none());
}
