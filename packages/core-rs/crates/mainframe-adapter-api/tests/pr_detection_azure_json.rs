//! Azure CLI JSON (`az repos pr create` / `az repos pr show`) as a tool result.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "Test assertions and scenarios"
)]

use mainframe_adapter_api::pr_detection::{DetectedPrCore, extract_pr_from_tool_result};

#[test]
fn azure_cli_json_uses_the_repository_not_an_earlier_name_key() {
    // Keys sorted as `az` prints them: a label's `name` precedes the repository's.
    let json = r#"WARNING: preview
{"labels": [{"name": "urgent"}], "pullRequestId": 7,
 "repository": {"name": "api", "webUrl": "https://contoso.visualstudio.com/Shop/_git/api/"}}"#;
    assert_eq!(
        extract_pr_from_tool_result(json),
        Some(DetectedPrCore {
            url: "https://contoso.visualstudio.com/Shop/_git/api/pullrequest/7".to_string(),
            owner: "contoso".to_string(),
            repo: "api".to_string(),
            number: 7,
        })
    );
}

/// The shape `az repos pr create` prints: every field, nulls included, keys
/// sorted, `repository.webUrl` null.
#[test]
fn azure_cli_json_rebuilds_the_link_from_the_api_url_and_encodes_names() {
    let json = r#"{"labels": [], "pullRequestId": 12,
 "repository": {"id": "r1", "name": "web api", "project": {"id": "p1", "name": "Contoso Web"},
  "remoteUrl": null, "url": "https://dev.azure.com/acme/p1/_apis/git/repositories/r1", "webUrl": null},
 "status": "active", "url": "https://dev.azure.com/acme/p1/_apis/git/repositories/r1/pullRequests/12"}
Done."#;
    assert_eq!(
        extract_pr_from_tool_result(json),
        Some(DetectedPrCore {
            url: "https://dev.azure.com/acme/Contoso%20Web/_git/web%20api/pullrequest/12"
                .to_string(),
            owner: "acme".to_string(),
            repo: "web api".to_string(),
            number: 12,
        })
    );
}

#[test]
fn azure_cli_json_list_reports_its_first_pull_request() {
    let json = r#"[{"pullRequestId": 3, "repository": {"name": "a", "webUrl": "https://dev.azure.com/o/p/_git/a"}},
 {"pullRequestId": 4, "repository": {"name": "b", "webUrl": "https://dev.azure.com/o/p/_git/b"}}]"#;
    assert_eq!(
        extract_pr_from_tool_result(json).map(|pr| pr.url),
        Some("https://dev.azure.com/o/p/_git/a/pullrequest/3".to_string())
    );
}

#[test]
fn azure_cli_json_without_a_repository_is_not_a_pr() {
    assert!(extract_pr_from_tool_result(r#"{"pullRequestId": 9}"#).is_none());
    assert!(extract_pr_from_tool_result(r#"{"pullRequestId": 9, "repository": "#).is_none());
}
