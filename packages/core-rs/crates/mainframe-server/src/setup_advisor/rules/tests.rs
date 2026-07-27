//! Dataset-level tests: the decision 22 regression pin, plus the evidence
//! helpers shared across categories.
//!
//! Decision 22: a worktree checkout gets no remote-derived recommendations.
//!
//! The enforcement lives one layer down — `detect_git_host` returns `None` when
//! `.git` is a `gitdir:` pointer file rather than a directory — so the affected
//! rules gate on `git_host` alone. That indirection is exactly what makes the
//! rule silently regressable: dropping a gate here still passes every
//! fingerprint test.

use mainframe_types::setup_advisor::{GitHost, ProjectFingerprint};

use super::{all, large_project_evidence};
use crate::setup_advisor::recommend::recommend;

/// T17: blind characterization of the shipped dataset, derived from the spec
/// and the command-provenance table rather than these rule files.
mod dataset_ac;
/// Every rule's own firing signal, one case each.
mod firing;
/// The hooks snippets run under `sh`; their exit codes are the behavior.
mod hook_snippets;
mod hooks;
mod install_flags;
mod scaffolds;

/// Every rule allowed to depend on a resolved remote. Adding a rule that fires
/// only when a host is present fails `remote_derived_rules_are_all_declared`
/// until it is listed here — which is the point: each entry is a claim that the
/// rule is useless without a remote, not merely better with one.
const REMOTE_DERIVED: &[&str] = &[
    "mcp-github",
    "plugins-pr-review-toolkit",
    "plugins-commit-commands",
    "skills-pr-check",
    "skills-release-notes",
];

/// Bare on purpose. In the end-to-end cases every other signal is empty so the
/// per-category cap of two cannot evict a remote-derived rule and fake a pass.
fn bare_fingerprint(git_host: Option<GitHost>) -> ProjectFingerprint {
    ProjectFingerprint {
        git_host,
        has_claude_config: true,
        ..ProjectFingerprint::default()
    }
}

fn ids(fp: &ProjectFingerprint) -> Vec<String> {
    recommend(fp).into_iter().map(|rec| rec.id).collect()
}

/// Rules whose evidence appears only once a host is known. Derived from the
/// dataset rather than listed, so a new remote-gated rule cannot slip in
/// unpinned. Both fingerprints differ in `git_host` alone, so any rule that
/// separates them did so on the remote.
fn rules_that_need_a_remote(host: GitHost) -> Vec<&'static str> {
    let without = bare_fingerprint(None);
    let with = bare_fingerprint(Some(host));
    all()
        .into_iter()
        .filter(|rule| rule.evaluate(&with).is_some() && rule.evaluate(&without).is_none())
        .map(|rule| rule.id)
        .collect()
}

#[test]
fn remote_derived_rules_are_all_declared() {
    let found = rules_that_need_a_remote(GitHost::Github);

    let undeclared: Vec<_> = found
        .iter()
        .filter(|id| !REMOTE_DERIVED.contains(id))
        .collect();
    assert!(
        undeclared.is_empty(),
        "these rules fire only with a git host but are not pinned by decision 22: {undeclared:?}"
    );

    let unenforced: Vec<_> = REMOTE_DERIVED
        .iter()
        .filter(|id| !found.contains(id))
        .collect();
    assert!(
        unenforced.is_empty(),
        "these rules are declared remote-derived but fire without a host: {unenforced:?}"
    );
}

#[test]
fn worktree_checkout_gets_no_remote_derived_recommendations() {
    let ids = ids(&bare_fingerprint(None));

    for id in REMOTE_DERIVED {
        assert!(
            !ids.contains(&(*id).to_string()),
            "{id} fired without a git host; ids were {ids:?}"
        );
    }
}

#[test]
fn a_real_github_remote_still_gets_the_forge_rules() {
    let ids = ids(&bare_fingerprint(Some(GitHost::Github)));

    for id in [
        "mcp-github",
        "plugins-pr-review-toolkit",
        "plugins-commit-commands",
    ] {
        assert!(
            ids.contains(&id.to_string()),
            "{id} did not fire on a github remote; ids were {ids:?}"
        );
    }
}

#[test]
fn a_gitlab_remote_gets_the_forge_plugins_but_not_the_github_server() {
    let ids = ids(&bare_fingerprint(Some(GitHost::Gitlab)));

    assert!(!ids.contains(&"mcp-github".to_string()));
    assert!(ids.contains(&"plugins-pr-review-toolkit".to_string()));
    assert!(ids.contains(&"plugins-commit-commands".to_string()));
}

/// `skills-pr-check` installs a body that shells out to `gh`, so a GitLab or
/// self-hosted remote must not earn it the way `skills-release-notes` does.
#[test]
fn only_a_github_remote_earns_the_gh_dependent_scaffold() {
    let gitlab = rules_that_need_a_remote(GitHost::Gitlab);

    assert!(!gitlab.contains(&"skills-pr-check"));
    assert!(gitlab.contains(&"skills-release-notes"));
}

/// The walk stops at 5,000 files, so a project at the cap must not be reported
/// as having exactly 5,000 — that is the ceiling, not a count.
#[test]
fn a_capped_file_count_is_reported_as_a_floor() {
    let fp = ProjectFingerprint {
        file_count: 5_000,
        ..ProjectFingerprint::default()
    };

    assert_eq!(
        large_project_evidence(&fp),
        Some("5000+ files in the project".to_string())
    );
}

#[test]
fn an_uncapped_file_count_is_reported_exactly() {
    let fp = ProjectFingerprint {
        file_count: 1_200,
        ..ProjectFingerprint::default()
    };

    assert_eq!(
        large_project_evidence(&fp),
        Some("1200 files in the project".to_string())
    );
}

#[test]
fn a_small_project_earns_no_size_evidence() {
    let fp = ProjectFingerprint {
        file_count: 500,
        ..ProjectFingerprint::default()
    };

    assert_eq!(large_project_evidence(&fp), None);
}
