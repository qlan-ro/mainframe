//! What the connectors rely on `GhCli` for: the three availability outcomes,
//! one probe per handle, the two failure texts, and the repo shape `gh api`
//! endpoints are built from.

use super::gh::{GhStatus, validate_repo};
use super::gh_stub::{StubGh, missing_gh};

const INSTALL_HINT: &str =
    "Install the GitHub CLI from https://cli.github.com, then run `gh auth login`.";

#[tokio::test]
async fn status_separates_missing_from_logged_out() {
    assert_eq!(StubGh::ready("").cli().status().await, GhStatus::Ready);
    assert_eq!(missing_gh().status().await, GhStatus::NotInstalled);
    assert_eq!(
        StubGh::logged_out().cli().status().await,
        GhStatus::NotAuthenticated
    );
}

#[tokio::test]
async fn clones_of_a_handle_share_one_probe() {
    let stub = StubGh::ready("");
    let cli = stub.cli();
    let clone = cli.clone();

    cli.status().await;
    clone.status().await;

    // Both GitHub actions hold clones, so building the catalog costs one
    // `gh auth status`, not one per action.
    assert_eq!(stub.calls(), ["auth status"]);
}

#[tokio::test]
async fn a_failing_gh_surfaces_its_own_stderr() {
    let stub = StubGh::failing(1, "gh: Not Found (HTTP 404)\n");

    let err = stub
        .cli()
        .output("GitHub create PR", &["api", "repos/o/r/pulls"], None)
        .await
        .unwrap_err();

    assert_eq!(
        err.0,
        "GitHub create PR failed (gh exited 1): gh: Not Found (HTTP 404)"
    );
}

#[tokio::test]
async fn a_missing_gh_says_how_to_install_it() {
    let err = missing_gh()
        .output("GitHub list PRs", &["search", "prs"], None)
        .await
        .unwrap_err();

    assert_eq!(
        err.0,
        format!("GitHub list PRs failed: the GitHub CLI isn't installed. {INSTALL_HINT}")
    );
}

#[test]
fn only_owner_slash_name_is_a_repo() {
    for repo in ["qlan/mainframe", "o/r.git", "a_b/c-d"] {
        assert!(validate_repo("github.create_pr", repo).is_ok(), "{repo}");
    }

    // Anything that could reshape the `repos/<repo>/pulls` endpoint path.
    for repo in [
        "mainframe",
        "o/r/pulls",
        "../..",
        "o/r?per_page=1",
        "o/",
        "/r",
    ] {
        let err = validate_repo("github.create_pr", repo).unwrap_err();
        assert_eq!(
            err.0,
            format!("invalid input for 'github.create_pr': repo '{repo}' must be 'owner/name'")
        );
    }
}
