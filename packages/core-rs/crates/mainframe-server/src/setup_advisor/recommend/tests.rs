//! Rule evaluation: ordering, the per-category cap, and evidence sanitization.
//! The rule set here is test-local on purpose — these assertions pin the engine,
//! not the shipped dataset.

use super::*;
use mainframe_types::setup_advisor::{RecommendationCategory, RecommendationProvenance};

use crate::setup_advisor::rule::{Evidence, RuleSource};

const fn rule(
    id: &'static str,
    category: RecommendationCategory,
    priority: u8,
    evidence: fn(&ProjectFingerprint) -> Option<String>,
) -> Rule {
    Rule {
        id,
        category,
        title: "Title",
        why: "Why",
        command: "echo constant",
        target_path: None,
        adapters: &["*"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority,
        evidence: Evidence::Custom(evidence),
    }
}

fn always(_fp: &ProjectFingerprint) -> Option<String> {
    Some("fired".to_string())
}

fn never(_fp: &ProjectFingerprint) -> Option<String> {
    None
}

fn ids(recommendations: &[AutomationRecommendation]) -> Vec<&str> {
    recommendations.iter().map(|r| r.id.as_str()).collect()
}

#[test]
fn orders_by_canonical_category_then_priority_within_a_category() {
    static PLUGIN: Rule = rule("plugin", RecommendationCategory::Plugins, 1, always);
    static SUBAGENT: Rule = rule("subagent", RecommendationCategory::Subagents, 1, always);
    static HOOK: Rule = rule("hook", RecommendationCategory::Hooks, 1, always);
    static SKILL_LATE: Rule = rule("skill-late", RecommendationCategory::Skills, 9, always);
    static SKILL_EARLY: Rule = rule("skill-early", RecommendationCategory::Skills, 2, always);
    static MCP: Rule = rule("mcp", RecommendationCategory::Mcp, 5, always);

    let out = recommend_with(
        &[&PLUGIN, &SUBAGENT, &HOOK, &SKILL_LATE, &SKILL_EARLY, &MCP],
        &ProjectFingerprint::default(),
    );

    assert_eq!(
        ids(&out),
        vec![
            "mcp",
            "skill-early",
            "skill-late",
            "hook",
            "subagent",
            "plugin"
        ]
    );
}

#[test]
fn keeps_at_most_two_per_category_by_priority() {
    static A: Rule = rule("a", RecommendationCategory::Mcp, 1, always);
    static B: Rule = rule("b", RecommendationCategory::Mcp, 2, always);
    static C: Rule = rule("c", RecommendationCategory::Mcp, 3, always);
    static D: Rule = rule("d", RecommendationCategory::Mcp, 4, always);

    let out = recommend_with(&[&D, &C, &B, &A], &ProjectFingerprint::default());

    assert_eq!(ids(&out), vec!["a", "b"]);
}

#[test]
fn a_category_with_no_firing_rule_contributes_nothing() {
    static FIRING: Rule = rule("firing", RecommendationCategory::Mcp, 1, always);
    static SILENT: Rule = rule("silent", RecommendationCategory::Hooks, 1, never);

    let out = recommend_with(&[&FIRING, &SILENT], &ProjectFingerprint::default());

    assert_eq!(ids(&out), vec!["firing"]);
}

#[test]
fn a_rule_whose_evidence_is_none_never_appears() {
    static SILENT: Rule = rule("silent", RecommendationCategory::Mcp, 1, never);

    let out = recommend_with(&[&SILENT], &ProjectFingerprint::default());

    assert!(out.is_empty());
}

#[test]
fn carries_the_rules_static_fields_onto_the_recommendation() {
    static SUPABASE: Rule = Rule {
        id: "mcp-supabase",
        category: RecommendationCategory::Mcp,
        title: "Supabase MCP server",
        why: "Query your Supabase project without leaving the session.",
        command: "claude mcp add supabase",
        target_path: Some(".claude/settings.json"),
        adapters: &["claude"],
        provenance: RecommendationProvenance::VendorOfficial,
        source: Some(RuleSource {
            repo: "supabase/supabase",
            installs: 1234,
        }),
        priority: 1,
        evidence: Evidence::Custom(|_| Some("@supabase/supabase-js in package.json".to_string())),
    };

    let out = recommend_with(&[&SUPABASE], &ProjectFingerprint::default());

    assert_eq!(out.len(), 1);
    let r = &out[0];
    assert_eq!(r.id, "mcp-supabase");
    assert_eq!(r.title, "Supabase MCP server");
    assert_eq!(
        r.why,
        "Query your Supabase project without leaving the session."
    );
    assert_eq!(r.command, "claude mcp add supabase");
    assert_eq!(r.target_path.as_deref(), Some(".claude/settings.json"));
    assert_eq!(r.adapters, vec!["claude".to_string()]);
    assert_eq!(r.provenance, RecommendationProvenance::VendorOfficial);
    assert_eq!(
        r.source.as_ref().map(|s| s.repo.as_str()),
        Some("supabase/supabase")
    );
    assert_eq!(r.source.as_ref().map(|s| s.installs), Some(1234));
    assert_eq!(r.signal, "@supabase/supabase-js in package.json");
}

#[test]
fn the_same_fingerprint_produces_identical_output_every_call() {
    static A: Rule = rule("a", RecommendationCategory::Mcp, 1, always);
    static B: Rule = rule("b", RecommendationCategory::Skills, 1, always);

    let fp = ProjectFingerprint::default();

    assert_eq!(
        recommend_with(&[&A, &B], &fp),
        recommend_with(&[&A, &B], &fp)
    );
}

#[test]
fn strips_control_characters_and_truncates_evidence_to_160_chars() {
    static NOISY: Rule = rule("noisy", RecommendationCategory::Mcp, 1, |_| {
        Some("a\nb\r\t".repeat(100))
    });

    let out = recommend_with(&[&NOISY], &ProjectFingerprint::default());

    let signal = &out[0].signal;
    assert!(!signal.chars().any(char::is_control));
    assert_eq!(signal.chars().count(), 160);
    assert_eq!(signal, &"ab".repeat(80));
}

#[test]
fn truncates_multibyte_evidence_at_a_char_boundary_not_a_byte_index() {
    // A naive `String::truncate(160)` panics here and passes the ASCII case
    // above: 160 is mid-character for every one of these.
    static WIDE: Rule = rule("wide", RecommendationCategory::Mcp, 1, |_| {
        Some("é".repeat(500))
    });

    let out = recommend_with(&[&WIDE], &ProjectFingerprint::default());

    assert_eq!(out[0].signal.chars().count(), 160);
    assert_eq!(out[0].signal, "é".repeat(160));
}

#[test]
fn truncates_emoji_evidence_at_a_char_boundary() {
    static EMOJI: Rule = rule("emoji", RecommendationCategory::Mcp, 1, |_| {
        Some("🚀".repeat(500))
    });

    let out = recommend_with(&[&EMOJI], &ProjectFingerprint::default());

    assert_eq!(out[0].signal.chars().count(), 160);
}
