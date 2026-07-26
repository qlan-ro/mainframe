//! AC 5, per-category cap: mcp priority is ordered by how specific a rule's
//! evidence is, so the broadest rule can never crowd out a precise one.

use mainframe_types::setup_advisor::{GitHost, ProjectFingerprint, RecommendationCategory};

use crate::setup_advisor::recommend::recommend;

fn mcp_ids(fp: &ProjectFingerprint) -> Vec<String> {
    recommend(fp)
        .into_iter()
        .filter(|r| r.category == RecommendationCategory::Mcp)
        .map(|r| r.id)
        .collect()
}

/// `mcp-context7` fires on any framework at all, so ranking it first — as the
/// plan's prose had it — would spend a capped slot on every project alive. A
/// React + Supabase + Sentry project must be told about Supabase instead.
#[test]
fn mcp_caps_at_two_and_the_broadest_rule_never_takes_a_slot() {
    let ids = mcp_ids(&ProjectFingerprint {
        frameworks: vec!["react".to_string()],
        databases: vec!["postgres".to_string(), "supabase".to_string()],
        git_host: Some(GitHost::Github),
        external_apis: vec!["aws".to_string(), "sentry".to_string()],
        ..Default::default()
    });

    assert_eq!(
        ids,
        vec!["mcp-supabase".to_string(), "mcp-postgres".to_string()],
        "expected only the top two mcp rules by priority; got {ids:?}"
    );
}

/// The other half of the ordering rule: with nothing but a framework to go on,
/// the broad rules are all that is left and they do surface. Without this the
/// test above would also pass if `mcp-context7` never fired at all.
#[test]
fn the_broadest_mcp_rules_surface_when_no_specific_signal_exists() {
    let ids = mcp_ids(&ProjectFingerprint {
        frameworks: vec!["react".to_string()],
        ..Default::default()
    });

    assert_eq!(
        ids,
        vec!["mcp-playwright".to_string(), "mcp-context7".to_string()],
        "expected the broad rules to fill the slots nothing else claimed; got {ids:?}"
    );
}
