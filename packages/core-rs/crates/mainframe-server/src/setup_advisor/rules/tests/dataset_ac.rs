//! T17: shipped-dataset expectations against the spec's category mappings and
//! `docs/research/2026-07-25-todo-191-command-provenance.md` **only** — written
//! without opening `mcp.rs`/`skills.rs`/`hooks.rs`/`subagents.rs`/`plugins.rs`.
//! A failure here means the T15/T16 dataset diverged from that contract; it is
//! not an expectation to adjust to match the code.

use mainframe_types::setup_advisor::{
    AutomationRecommendation, ProjectFingerprint, RecommendationCategory, RecommendationProvenance,
};

use super::super::all;
use crate::setup_advisor::recommend::recommend;

/// The injection cases (AC 6) and the cap-ordering cases (AC 5) live separately
/// to keep this file under the 300-line limit.
mod injection;
mod ordering;

fn rec<'a>(recs: &'a [AutomationRecommendation], id: &str) -> &'a AutomationRecommendation {
    recs.iter().find(|r| r.id == id).unwrap_or_else(|| {
        let ids: Vec<&str> = recs.iter().map(|r| r.id.as_str()).collect();
        panic!("expected rule `{id}` to fire; got {ids:?}")
    })
}

/// AC 4: one representative fingerprint, one hardcoded expectation per category.
/// `databases: [postgres]` + `tooling: [prettier]` was chosen so exactly the
/// rules below fire (verified against the spec's predicate list, not the code):
/// no other mcp/skills/subagents predicate keys off an empty `frameworks`/
/// `languages`/`externalApis`/`dirs`, and `hasClaudeConfig: true` picks
/// `plugin-dev` over `claude-code-setup` without adding a third plugins hit.
#[test]
fn a_postgres_and_prettier_project_recommends_across_all_five_categories() {
    let fp = ProjectFingerprint {
        databases: vec!["postgres".to_string()],
        tooling: vec!["prettier".to_string()],
        has_claude_config: true,
        ..Default::default()
    };
    let recs = recommend(&fp);

    let mcp = rec(&recs, "mcp-postgres");
    assert_eq!(mcp.category, RecommendationCategory::Mcp);
    assert_eq!(mcp.adapters, vec!["*".to_string()]);
    assert_eq!(mcp.provenance, RecommendationProvenance::VendorOfficial);
    assert_eq!(
        mcp.command,
        "claude mcp add --transport stdio db -- npx -y @bytebase/dbhub --dsn \"postgresql://USER:PASSWORD@HOST:5432/DATABASE\""
    );
    assert!(!mcp.signal.is_empty());
    assert!(!mcp.why.is_empty());

    let skill = rec(&recs, "skills-postgres");
    assert_eq!(skill.adapters, vec!["*".to_string()]);
    assert_eq!(skill.provenance, RecommendationProvenance::VendorOfficial);
    assert_eq!(
        skill.command,
        "npx skills add supabase/agent-skills --skill supabase-postgres-best-practices -a claude-code -g -y"
    );

    // No `-y`: the third-party tier keeps its install confirmation, which is the
    // decision `install_flags.rs` enforces across the tier.
    let merged = rec(&recs, "skills-eslint-prettier");
    assert_eq!(merged.provenance, RecommendationProvenance::ThirdParty);
    assert_eq!(
        merged.command,
        "npx skills add patricio0312rev/skills --skill eslint-prettier-config -a claude-code -g"
    );

    let hook = rec(&recs, "hooks-format-on-edit");
    assert_eq!(hook.adapters, vec!["claude".to_string()]);
    assert_eq!(hook.target_path.as_deref(), Some(".claude/settings.json"));
    assert!(hook.command.contains("PostToolUse"));

    let subagent = rec(&recs, "subagents-performance-analyzer");
    assert_eq!(subagent.adapters, vec!["claude".to_string()]);
    assert_eq!(
        subagent.target_path.as_deref(),
        Some(".claude/agents/performance-analyzer.md")
    );

    let plugin = rec(&recs, "plugins-hookify");
    assert_eq!(
        plugin.command,
        "/plugin install hookify@claude-plugins-official"
    );
    assert_eq!(plugin.provenance, RecommendationProvenance::FirstParty);

    let plugin_dev = rec(&recs, "plugins-plugin-dev");
    assert_eq!(
        plugin_dev.command,
        "/plugin install plugin-dev@claude-plugins-official"
    );
}

/// AC 5, empty category: nothing in this fingerprint satisfies any subagents
/// predicate in the spec's mapping (fileCount>500, an auth-library external
/// API, non-empty languages, an api dir/backend framework, non-empty
/// databases, or a frontend framework).
#[test]
fn a_fingerprint_with_no_subagent_signal_recommends_nothing_in_that_category() {
    let fp = ProjectFingerprint {
        has_claude_config: true,
        ..Default::default()
    };

    let subagent_ids: Vec<String> = recommend(&fp)
        .into_iter()
        .filter(|r| r.category == RecommendationCategory::Subagents)
        .map(|r| r.id)
        .collect();

    assert!(
        subagent_ids.is_empty(),
        "expected no subagents rules; got {subagent_ids:?}"
    );
}

/// Every skills `command` is either the deterministic `npx skills add` long
/// form or a scaffold snippet paired with a `.claude/skills/*/SKILL.md` path —
/// the two shapes the spec and T2 describe; nothing else is a valid skills row.
#[test]
fn every_skills_rule_is_a_registry_install_or_a_scaffold_snippet() {
    for r in all()
        .into_iter()
        .filter(|r| r.category == RecommendationCategory::Skills)
    {
        let is_registry_install = r.command.starts_with("npx skills add ");
        let is_scaffold = r
            .target_path
            .map(|p| p.starts_with(".claude/skills/") && p.ends_with("/SKILL.md"))
            .unwrap_or(false);
        assert!(
            is_registry_install || is_scaffold,
            "skills rule `{}` is neither a registry install nor a scaffold snippet (command={:?}, target_path={:?})",
            r.id,
            r.command,
            r.target_path
        );
    }
}

/// Ids feed testids (spec AC 4), so a collision would silently merge two rules'
/// UI affordances.
#[test]
fn rule_ids_are_unique_across_the_whole_dataset() {
    let mut ids: Vec<&str> = all().iter().map(|r| r.id).collect();
    let total = ids.len();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(
        ids.len(),
        total,
        "duplicate rule ids in the shipped dataset"
    );
}

/// T2: mcp rules are vendor-official; hooks/subagents/plugins are first-party.
#[test]
fn provenance_matches_the_tier_assigned_per_category() {
    for r in all() {
        match r.category {
            RecommendationCategory::Mcp => assert_eq!(
                r.provenance,
                RecommendationProvenance::VendorOfficial,
                "{}",
                r.id
            ),
            RecommendationCategory::Hooks
            | RecommendationCategory::Subagents
            | RecommendationCategory::Plugins => {
                assert_eq!(
                    r.provenance,
                    RecommendationProvenance::FirstParty,
                    "{}",
                    r.id
                )
            }
            RecommendationCategory::Skills => {}
        }
    }
}

/// T2's skills tables name an exact rule per tier: 17 vendor-official sources;
/// 19 third-party aggregator rows that collapse to 18 rules (the prettier and
/// eslint signals are "deliberately" merged into one `skills-eslint-prettier`
/// rule); 8 custom-scaffold fallbacks pinned first-party ("these scaffold a
/// file the user owns, fetching nothing"). A category-only check can't catch a
/// rule landing in the wrong tier within skills, so this counts each tier.
#[test]
fn skills_rules_split_into_the_three_tiers_at_the_counts_the_provenance_doc_gives() {
    let mut vendor_official = 0;
    let mut third_party = 0;
    let mut first_party = 0;
    for r in all()
        .into_iter()
        .filter(|r| r.category == RecommendationCategory::Skills)
    {
        match r.provenance {
            RecommendationProvenance::VendorOfficial => vendor_official += 1,
            RecommendationProvenance::ThirdParty => third_party += 1,
            RecommendationProvenance::FirstParty => first_party += 1,
        }
    }

    assert_eq!(vendor_official, 17, "vendor-official skills rule count");
    assert_eq!(third_party, 18, "third-party skills rule count");
    assert_eq!(first_party, 8, "first-party scaffold skills rule count");
}

/// Spec: mcp/skills are cross-agent (`["*"]`); hooks/subagents/plugins are
/// Claude-only (`["claude"]`).
#[test]
fn adapters_match_the_cross_agent_or_claude_only_split() {
    for r in all() {
        match r.category {
            RecommendationCategory::Mcp | RecommendationCategory::Skills => {
                assert_eq!(r.adapters.to_vec(), vec!["*"], "{}", r.id)
            }
            RecommendationCategory::Hooks
            | RecommendationCategory::Subagents
            | RecommendationCategory::Plugins => {
                assert_eq!(r.adapters.to_vec(), vec!["claude"], "{}", r.id)
            }
        }
    }
}

#[test]
fn hooks_rules_all_target_the_shared_settings_file() {
    for r in all()
        .into_iter()
        .filter(|r| r.category == RecommendationCategory::Hooks)
    {
        assert_eq!(r.target_path, Some(".claude/settings.json"), "{}", r.id);
    }
}

#[test]
fn subagents_rules_target_a_markdown_file_under_dot_claude_agents() {
    for r in all()
        .into_iter()
        .filter(|r| r.category == RecommendationCategory::Subagents)
    {
        let path = r
            .target_path
            .unwrap_or_else(|| panic!("{} has no target_path", r.id));
        assert!(
            path.starts_with(".claude/agents/") && path.ends_with(".md"),
            "{}: {path}",
            r.id
        );
    }
}
