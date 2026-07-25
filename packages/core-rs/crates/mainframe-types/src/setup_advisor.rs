//! Mirrors `packages/types/src/setup-advisor.ts` — the Setup Advisor wire contract.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecommendationCategory {
    Mcp,
    Skills,
    Hooks,
    Subagents,
    Plugins,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GitHost {
    Github,
    Gitlab,
    Other,
}

/// Whose code the command installs.
///
/// The UI must keep the three visually distinct: running a `ThirdParty` command
/// puts an unaffiliated author's content on the user's machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecommendationProvenance {
    /// Nothing external is fetched — an Anthropic command, a hook config
    /// snippet, or a skill scaffold this app authors.
    FirstParty,
    /// Published by the technology's own vendor or a core maintainer of it.
    VendorOfficial,
    /// An unaffiliated author's aggregator repo.
    ThirdParty,
}

/// Attribution for a command that installs a published repo's content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationSource {
    /// GitHub `owner/repo` the command installs from.
    pub repo: String,
    /// skills.sh install count when the dataset was compiled. Not live.
    pub installs: u64,
}

/// A single Claude Code automation suggested for a project, derived from concrete
/// evidence in that project's files.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRecommendation {
    /// Stable kebab-case rule id, e.g. "mcp-supabase". Used in testids.
    pub id: String,
    pub category: RecommendationCategory,
    pub title: String,
    /// The concrete detected evidence, e.g. "@supabase/supabase-js in package.json".
    pub signal: String,
    /// One line: what the automation buys you, phrased off the signal.
    pub why: String,
    /// Copyable install/create text.
    ///
    /// INVARIANT: a constant per rule — no fingerprint-derived substring ever enters
    /// it. Fingerprint content (dependency names, git remote URLs) is attacker-
    /// controlled for any cloned repo, and this string feeds a shell.
    pub command: String,
    /// Where the artifact lives once created, e.g. ".claude/settings.json".
    /// Absent rather than null on the wire, matching the optional TS field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_path: Option<String>,
    /// Adapter ids this applies to; `["*"]` = any adapter.
    pub adapters: Vec<String>,
    pub provenance: RecommendationProvenance,
    /// Absent for `FirstParty` rules, which fetch nobody's repo. Absent rather
    /// than null on the wire, matching the optional TS field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<RecommendationSource>,
}

/// What the engine detected about a project. Display-only strings; never
/// interpolated into commands.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFingerprint {
    pub languages: Vec<String>,
    pub frameworks: Vec<String>,
    pub databases: Vec<String>,
    pub external_apis: Vec<String>,
    pub testing: Vec<String>,
    pub tooling: Vec<String>,
    pub git_host: Option<GitHost>,
    /// `.claude/` or `CLAUDE.md` present. Its absence recommends `claude-code-setup`.
    pub has_claude_config: bool,
    pub has_env_files: bool,
    pub has_lock_files: bool,
    /// Detected subset of: src, app, components, tests, api.
    pub dirs: Vec<String>,
    /// Bounded approximation — the walk stops at a cap rather than counting every file.
    pub file_count: u64,
    /// Human-readable evidence chips, e.g. "TypeScript", "Next.js".
    pub signals: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupAdvisorReport {
    pub fingerprint: ProjectFingerprint,
    /// Ordered: canonical category order (mcp, skills, hooks, subagents, plugins),
    /// then rule priority within a category.
    pub recommendations: Vec<AutomationRecommendation>,
}

#[cfg(test)]
mod tests;
