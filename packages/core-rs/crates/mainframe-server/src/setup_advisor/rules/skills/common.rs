//! Constructors and predicates shared by the skills sub-families.

use mainframe_types::setup_advisor::{RecommendationCategory, RecommendationProvenance};

use crate::setup_advisor::rule::{Evidence, Rule, RuleSource};

/// A rule whose command installs a published repo through `npx skills add`.
///
/// Always the deterministic long form. The bare `npx skills add <repo>` prompts
/// interactively on any multi-skill repo, so a user pasting it into a terminal
/// gets a menu rather than the skill the card named.
#[allow(clippy::too_many_arguments)]
const fn registry_rule(
    id: &'static str,
    title: &'static str,
    why: &'static str,
    command: &'static str,
    provenance: RecommendationProvenance,
    repo: &'static str,
    installs: u64,
    priority: u8,
    evidence: Evidence,
) -> Rule {
    Rule {
        id,
        category: RecommendationCategory::Skills,
        title,
        why,
        command,
        target_path: None,
        adapters: &["*"],
        provenance,
        source: Some(RuleSource { repo, installs }),
        priority,
        evidence,
    }
}

/// Published by the technology's own vendor, or by a core maintainer of it.
#[allow(clippy::too_many_arguments)]
pub(super) const fn vendor(
    id: &'static str,
    title: &'static str,
    why: &'static str,
    command: &'static str,
    repo: &'static str,
    installs: u64,
    priority: u8,
    evidence: Evidence,
) -> Rule {
    registry_rule(
        id,
        title,
        why,
        command,
        RecommendationProvenance::VendorOfficial,
        repo,
        installs,
        priority,
        evidence,
    )
}

/// An unaffiliated author's repo. `repo` and `installs` are what let the user see
/// they are pulling a stranger's content, so both are transcribed exactly from
/// the provenance doc's third-party table.
///
/// For the same reason no command in this tier passes `-y`: the confirmation it
/// would skip is the last place the install names whose content is about to run.
#[allow(clippy::too_many_arguments)]
pub(super) const fn aggregator(
    id: &'static str,
    title: &'static str,
    why: &'static str,
    command: &'static str,
    repo: &'static str,
    installs: u64,
    priority: u8,
    evidence: Evidence,
) -> Rule {
    registry_rule(
        id,
        title,
        why,
        command,
        RecommendationProvenance::ThirdParty,
        repo,
        installs,
        priority,
        evidence,
    )
}

/// A SKILL.md the user's own repo will own. Nothing is fetched, so no `source`.
pub(super) const fn scaffold(
    id: &'static str,
    title: &'static str,
    why: &'static str,
    command: &'static str,
    target_path: &'static str,
    priority: u8,
    evidence: Evidence,
) -> Rule {
    Rule {
        id,
        category: RecommendationCategory::Skills,
        title,
        why,
        command,
        target_path: Some(target_path),
        adapters: &["*"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority,
        evidence,
    }
}
