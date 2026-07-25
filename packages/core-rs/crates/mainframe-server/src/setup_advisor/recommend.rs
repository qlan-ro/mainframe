//! Evaluates the rules dataset against a fingerprint.

use mainframe_types::setup_advisor::{
    AutomationRecommendation, ProjectFingerprint, RecommendationCategory, RecommendationSource,
};

use super::rule::Rule;
use super::rules;

/// Display order, and the order the sheet's sections appear in.
const CATEGORY_ORDER: &[RecommendationCategory] = &[
    RecommendationCategory::Mcp,
    RecommendationCategory::Skills,
    RecommendationCategory::Hooks,
    RecommendationCategory::Subagents,
    RecommendationCategory::Plugins,
];

/// A sheet section stays scannable at two entries; a longer list reads as noise
/// and the user stops evaluating any of it.
const PER_CATEGORY_CAP: usize = 2;

/// Longest evidence string shown on a card.
const SIGNAL_MAX_CHARS: usize = 160;

/// Evidence is fingerprint-derived, so it carries whatever a cloned repo put in
/// its manifest. Strip control characters before it reaches a UI, and cap by
/// **chars** — `String::truncate` panics on a byte index inside a character.
fn sanitize_signal(raw: &str) -> String {
    raw.chars()
        .filter(|c| !c.is_control())
        .take(SIGNAL_MAX_CHARS)
        .collect()
}

fn to_recommendation(rule: &Rule, signal: String) -> AutomationRecommendation {
    AutomationRecommendation {
        id: rule.id.to_string(),
        category: rule.category,
        title: rule.title.to_string(),
        signal: sanitize_signal(&signal),
        why: rule.why.to_string(),
        command: rule.command.to_string(),
        target_path: rule.target_path.map(str::to_string),
        adapters: rule.adapters.iter().map(|a| (*a).to_string()).collect(),
        provenance: rule.provenance,
        source: rule.source.map(|source| RecommendationSource {
            repo: source.repo.to_string(),
            installs: source.installs,
        }),
    }
}

/// The firing rules of one category, lowest priority first, capped.
fn category_slice(
    rules: &[&'static Rule],
    fp: &ProjectFingerprint,
    category: RecommendationCategory,
) -> Vec<AutomationRecommendation> {
    let mut firing: Vec<&&'static Rule> = rules
        .iter()
        .filter(|rule| rule.category == category)
        .collect();
    firing.sort_by_key(|rule| (rule.priority, rule.id));
    firing
        .iter()
        .filter_map(|rule| (rule.evidence)(fp).map(|signal| to_recommendation(rule, signal)))
        .take(PER_CATEGORY_CAP)
        .collect()
}

/// Returns the recommendations whose evidence is actually present in `fp`, in
/// canonical category order then rule priority. Never pads.
pub fn recommend(fp: &ProjectFingerprint) -> Vec<AutomationRecommendation> {
    recommend_with(&rules::all(), fp)
}

/// The testable seam: the same evaluation against an explicit rule set.
pub fn recommend_with(
    rules: &[&'static Rule],
    fp: &ProjectFingerprint,
) -> Vec<AutomationRecommendation> {
    CATEGORY_ORDER
        .iter()
        .flat_map(|category| category_slice(rules, fp, *category))
        .collect()
}

#[cfg(test)]
mod tests;
