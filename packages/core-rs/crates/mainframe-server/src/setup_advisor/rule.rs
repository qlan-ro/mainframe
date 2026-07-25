//! The `Rule` type backing the dataset in `rules/`, and the small language its
//! rows state their trigger in.

use mainframe_types::setup_advisor::{
    ProjectFingerprint, RecommendationCategory, RecommendationProvenance,
};

use super::detections::{Field, has, values};

/// What a rule looks for in a fingerprint, and the evidence it shows when it
/// finds it.
///
/// Data rather than a closure per rule: a row then reads as the mapping it is,
/// reviewable against the provenance doc without following a function out of the
/// table. `Custom` carries the few triggers no table shape states — file counts,
/// git hosts, the absence of a thing.
pub enum Evidence {
    /// `key` is present in `field`.
    Detected(Field, &'static str, &'static str),
    /// The first of `keys` present in `field`, named in `"<key> <suffix>"`, so
    /// the evidence reports the one that fired rather than the whole family.
    ///
    /// Interpolating the key is safe and stays safe: `keys` are rule constants,
    /// and this lands in display text, never in a `command`.
    First(Field, &'static [&'static str], &'static str),
    /// Whatever `field` holds first, named in `"<value> <suffix>"` — for rules
    /// that fire on a category rather than on a member of it. The values are
    /// canonical labels from `manifests.rs`, never raw dependency names.
    Any(Field, &'static str),
    /// The first alternative that fires, so one rule can accept a directory or a
    /// dependency as the same fact.
    Either(&'static [Evidence]),
    Custom(fn(&ProjectFingerprint) -> Option<String>),
}

impl Evidence {
    fn find(&self, fp: &ProjectFingerprint) -> Option<String> {
        match self {
            Evidence::Detected(field, key, evidence) => {
                has(values(fp, *field), key).then(|| (*evidence).to_string())
            }
            Evidence::First(field, keys, suffix) => keys
                .iter()
                .find(|key| has(values(fp, *field), key))
                .map(|key| format!("{key} {suffix}")),
            Evidence::Any(field, suffix) => values(fp, *field)
                .first()
                .map(|value| format!("{value} {suffix}")),
            Evidence::Either(alternatives) => alternatives
                .iter()
                .find_map(|alternative| alternative.find(fp)),
            Evidence::Custom(predicate) => predicate(fp),
        }
    }
}

/// Attribution for a rule whose command installs a published repo's content.
/// `&'static` for the same reason `command` is: it ships with the rule.
#[derive(Debug, Clone, Copy)]
pub struct RuleSource {
    /// GitHub `owner/repo` the command installs from.
    pub repo: &'static str,
    /// skills.sh install count when the dataset was compiled. Not live.
    pub installs: u64,
}

/// One shipped recommendation and the evidence that earns it.
pub struct Rule {
    /// Stable kebab-case id, e.g. `mcp-supabase`. Reaches the UI as a testid.
    pub id: &'static str,
    pub category: RecommendationCategory,
    pub title: &'static str,
    pub why: &'static str,
    /// INVARIANT (spec decision 20): a rule constant. `&'static str` makes a
    /// fingerprint-derived command a compile error, not a review catch.
    pub command: &'static str,
    pub target_path: Option<&'static str>,
    pub adapters: &'static [&'static str],
    /// Whose code `command` installs. The UI shows third-party distinctly, so a
    /// user can see when they are pulling from an unaffiliated author.
    pub provenance: RecommendationProvenance,
    /// Absent for first-party rules, which fetch nobody's repo, and for the
    /// categories with no registry entry to attribute.
    pub source: Option<RuleSource>,
    /// Lower fires first within a category.
    pub priority: u8,
    /// What earns this rule its place on the sheet.
    pub evidence: Evidence,
}

impl Rule {
    /// The evidence this fingerprint gives the rule, or `None` when it gives none.
    pub fn evaluate(&self, fp: &ProjectFingerprint) -> Option<String> {
        self.evidence.find(fp)
    }
}
