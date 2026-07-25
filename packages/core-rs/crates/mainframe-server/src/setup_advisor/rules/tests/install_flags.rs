//! What a command is allowed to do to the user's machine before they have said
//! yes to it. Every rule here is a card the user has only read, not accepted.

use mainframe_types::setup_advisor::{RecommendationCategory, RecommendationProvenance};

use super::super::all;

/// `--scope project` writes a tracked `.mcp.json` into the repo and `--scope
/// user` writes a config every other project then inherits. Both are side
/// effects the card never mentions, so every command leaves the scope at its
/// default and touches nothing outside this checkout's local config.
#[test]
fn no_mcp_command_reaches_outside_the_default_scope() {
    for rule in all()
        .into_iter()
        .filter(|rule| rule.category == RecommendationCategory::Mcp)
    {
        assert!(
            !rule.command.contains("--scope"),
            "{} picks a scope the card does not disclose: {:?}",
            rule.id,
            rule.command
        );
    }
}

/// Design ruling: installing an unaffiliated author's skill stays a visible
/// decision. `-y` auto-accepts the install, which is exactly the prompt that
/// would have shown the user whose content they are about to run.
#[test]
fn no_third_party_install_auto_accepts_on_the_users_behalf() {
    for rule in all()
        .into_iter()
        .filter(|rule| rule.provenance == RecommendationProvenance::ThirdParty)
    {
        assert!(
            !rule.command.contains(" -y"),
            "{} accepts a stranger's install without showing it: {:?}",
            rule.id,
            rule.command
        );
    }
}

/// The other half: dropping `-y` everywhere would be a different change. Vendor
/// rows install the technology's own maintainers' content and keep it.
#[test]
fn vendor_official_installs_are_unchanged() {
    let vendor_with_auto_accept = all()
        .into_iter()
        .filter(|rule| rule.category == RecommendationCategory::Skills)
        .filter(|rule| rule.provenance == RecommendationProvenance::VendorOfficial)
        .filter(|rule| rule.command.ends_with(" -g -y"))
        .count();

    assert_eq!(vendor_with_auto_accept, 17);
}
