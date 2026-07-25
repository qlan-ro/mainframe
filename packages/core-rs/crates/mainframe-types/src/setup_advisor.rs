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
mod tests {
    use super::*;
    use serde_json::json;

    fn recommendation() -> serde_json::Value {
        json!({
            "id": "mcp-supabase",
            "category": "mcp",
            "title": "Supabase MCP server",
            "signal": "@supabase/supabase-js in package.json",
            "why": "Query your Supabase project without leaving the session.",
            "command": "claude mcp add --scope project --transport http supabase \"https://mcp.supabase.com/mcp\"",
            "targetPath": ".claude/settings.json",
            "adapters": ["*"],
            "provenance": "vendor-official"
        })
    }

    fn fingerprint() -> serde_json::Value {
        json!({
            "languages": ["typescript"],
            "frameworks": ["react", "nextjs"],
            "databases": ["supabase"],
            "externalApis": ["stripe"],
            "testing": ["vitest"],
            "tooling": ["prettier"],
            "gitHost": "github",
            "hasClaudeConfig": true,
            "hasEnvFiles": true,
            "hasLockFiles": true,
            "dirs": ["src", "tests"],
            "fileCount": 421,
            "signals": ["TypeScript", "Next.js"]
        })
    }

    #[test]
    fn recommendation_round_trips_camel_case_field_names() {
        let r: AutomationRecommendation = serde_json::from_value(recommendation()).unwrap();
        assert_eq!(r.id, "mcp-supabase");
        assert_eq!(r.category, RecommendationCategory::Mcp);
        assert_eq!(r.target_path.as_deref(), Some(".claude/settings.json"));
        assert_eq!(serde_json::to_value(&r).unwrap(), recommendation());
    }

    #[test]
    fn recommendation_omits_absent_target_path_rather_than_nulling_it() {
        let mut v = recommendation();
        v.as_object_mut().unwrap().remove("targetPath");
        let r: AutomationRecommendation = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(r.target_path, None);
        let out = serde_json::to_value(&r).unwrap();
        assert!(out.get("targetPath").is_none());
        assert_eq!(out, v);
    }

    #[test]
    fn recommendation_rejects_an_unknown_category() {
        let mut v = recommendation();
        v["category"] = json!("workflows");
        assert!(serde_json::from_value::<AutomationRecommendation>(v).is_err());
    }

    #[test]
    fn recommendation_rejects_a_missing_command() {
        let mut v = recommendation();
        v.as_object_mut().unwrap().remove("command");
        assert!(serde_json::from_value::<AutomationRecommendation>(v).is_err());
    }

    #[test]
    fn fingerprint_round_trips_camel_case_field_names() {
        let f: ProjectFingerprint = serde_json::from_value(fingerprint()).unwrap();
        assert_eq!(f.external_apis, vec!["stripe".to_string()]);
        assert!(f.has_claude_config);
        assert!(f.has_env_files);
        assert!(f.has_lock_files);
        assert_eq!(f.file_count, 421);
        assert_eq!(f.git_host, Some(GitHost::Github));
        assert_eq!(serde_json::to_value(&f).unwrap(), fingerprint());
    }

    #[test]
    fn fingerprint_round_trips_a_null_git_host() {
        let mut v = fingerprint();
        v["gitHost"] = json!(null);
        let f: ProjectFingerprint = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(f.git_host, None);
        assert_eq!(serde_json::to_value(&f).unwrap(), v);
    }

    #[test]
    fn fingerprint_accepts_each_git_host_and_rejects_an_unknown_one() {
        for (wire, expected) in [
            ("github", GitHost::Github),
            ("gitlab", GitHost::Gitlab),
            ("other", GitHost::Other),
        ] {
            let mut v = fingerprint();
            v["gitHost"] = json!(wire);
            let f: ProjectFingerprint = serde_json::from_value(v).unwrap();
            assert_eq!(f.git_host, Some(expected));
        }
        let mut v = fingerprint();
        v["gitHost"] = json!("bitbucket");
        assert!(serde_json::from_value::<ProjectFingerprint>(v).is_err());
    }

    #[test]
    fn default_fingerprint_is_empty() {
        let f = ProjectFingerprint::default();
        assert!(f.languages.is_empty());
        assert_eq!(f.git_host, None);
        assert_eq!(f.file_count, 0);
        assert!(!f.has_claude_config);
    }

    #[test]
    fn report_round_trips_and_rejects_a_missing_fingerprint() {
        let v = json!({ "fingerprint": fingerprint(), "recommendations": [recommendation()] });
        let r: SetupAdvisorReport = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(r.recommendations.len(), 1);
        assert_eq!(serde_json::to_value(&r).unwrap(), v);

        let missing = json!({ "recommendations": [] });
        assert!(serde_json::from_value::<SetupAdvisorReport>(missing).is_err());
    }

    #[test]
    fn provenance_serializes_kebab_case_variants() {
        assert_eq!(
            serde_json::to_string(&RecommendationProvenance::FirstParty).unwrap(),
            "\"first-party\""
        );
        assert_eq!(
            serde_json::to_string(&RecommendationProvenance::VendorOfficial).unwrap(),
            "\"vendor-official\""
        );
        assert_eq!(
            serde_json::to_string(&RecommendationProvenance::ThirdParty).unwrap(),
            "\"third-party\""
        );
    }

    #[test]
    fn provenance_deserializes_kebab_case_variants() {
        assert_eq!(
            serde_json::from_str::<RecommendationProvenance>("\"first-party\"").unwrap(),
            RecommendationProvenance::FirstParty
        );
        assert_eq!(
            serde_json::from_str::<RecommendationProvenance>("\"vendor-official\"").unwrap(),
            RecommendationProvenance::VendorOfficial
        );
        assert_eq!(
            serde_json::from_str::<RecommendationProvenance>("\"third-party\"").unwrap(),
            RecommendationProvenance::ThirdParty
        );
    }

    #[test]
    fn recommendation_with_no_source_omits_the_source_key_entirely() {
        let r: AutomationRecommendation = serde_json::from_value(recommendation()).unwrap();
        assert_eq!(r.source, None);
        let out = serde_json::to_string(&r).unwrap();
        assert!(!out.contains("source"));
        let r2: AutomationRecommendation = serde_json::from_str(&out).unwrap();
        assert_eq!(r2.source, None);
    }

    #[test]
    fn recommendation_with_source_serializes_camel_case_repo_and_installs() {
        let mut v = recommendation();
        v["source"] = json!({ "repo": "wshobson/agents", "installs": 12345 });
        let r: AutomationRecommendation = serde_json::from_value(v).unwrap();
        assert_eq!(
            r.source,
            Some(RecommendationSource {
                repo: "wshobson/agents".to_string(),
                installs: 12345,
            })
        );
        let out = serde_json::to_string(&r).unwrap();
        assert!(out.contains("\"source\":{\"repo\":\"wshobson/agents\",\"installs\":12345}"));
    }

    #[test]
    fn deserializes_a_third_party_provenance_from_a_ts_side_payload() {
        let mut v = recommendation();
        v["provenance"] = json!("third-party");
        let r: AutomationRecommendation = serde_json::from_value(v).unwrap();
        assert_eq!(r.provenance, RecommendationProvenance::ThirdParty);
    }
}
