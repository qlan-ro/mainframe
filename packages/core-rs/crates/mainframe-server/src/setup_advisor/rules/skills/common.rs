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

pub(super) const fn vendor(input: RegistryRule) -> Rule {
    registry_rule(input, RecommendationProvenance::VendorOfficial)
}

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
