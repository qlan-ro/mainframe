//! The `Rule` type backing the dataset in `rules/`.

use mainframe_types::setup_advisor::{
    ProjectFingerprint, RecommendationCategory, RecommendationProvenance,
};

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
    /// Returns the concrete evidence string when the rule fires.
    pub evidence: fn(&ProjectFingerprint) -> Option<String>,
}
