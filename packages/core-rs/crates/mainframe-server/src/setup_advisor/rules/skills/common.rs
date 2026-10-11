//! Constructors and predicates shared by the skills sub-families.

use crate::setup_advisor::rule::{Evidence, Rule, RuleSource};
use mainframe_types::setup_advisor::{RecommendationCategory, RecommendationProvenance};

pub(super) struct RegistryRule {
    pub id: &'static str,
    pub title: &'static str,
    pub why: &'static str,
    pub command: &'static str,
    pub repo: &'static str,
    pub installs: u64,
    pub priority: u8,
    pub evidence: Evidence,
}

/// A rule whose command installs a published repo through `npx skills add`.
///
/// Always the deterministic long form. The bare `npx skills add <repo>` prompts
/// interactively on any multi-skill repo, so a user pasting it into a terminal
/// gets a menu rather than the skill the card named.
const fn registry_rule(input: RegistryRule, provenance: RecommendationProvenance) -> Rule {
    Rule {
        id: input.id,
        category: RecommendationCategory::Skills,
        title: input.title,
        why: input.why,
        command: input.command,
        target_path: None,
        adapters: &["*"],
        provenance,
        source: Some(RuleSource {
            repo: input.repo,
            installs: input.installs,
        }),
        priority: input.priority,
        evidence: input.evidence,
    }
}

/// Published by the technology's own vendor, or by a core maintainer of it.
pub(super) const fn vendor(input: RegistryRule) -> Rule {
    registry_rule(input, RecommendationProvenance::VendorOfficial)
}

/// An unaffiliated author's repo. `repo` and `installs` are what let the user see
/// they are pulling a stranger's content, so both are transcribed exactly from
/// the provenance doc's third-party table.
///
/// For the same reason no command in this tier passes `-y`: the confirmation it
/// would skip is the last place the install names whose content is about to run.
pub(super) const fn aggregator(input: RegistryRule) -> Rule {
    registry_rule(input, RecommendationProvenance::ThirdParty)
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
