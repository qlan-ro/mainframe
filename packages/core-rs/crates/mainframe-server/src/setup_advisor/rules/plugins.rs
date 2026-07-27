//! Plugin rules — `/plugin install <name>@claude-plugins-official`.
//!
//! Mappings come from the upstream `claude-code-setup` v1.0.0 bundle
//! (`references/plugins-reference.md`). Every plugin name below was verified
//! present in the local `claude-plugins-official` marketplace manifest and is
//! recorded in the plugins table of
//! `docs/research/2026-07-25-todo-191-command-provenance.md`; a name absent from
//! that table does not ship.
//!
//! Tier is `first-party`: the marketplace is Anthropic's own, so no unaffiliated
//! author's code is fetched. `/plugin install` is also typed inside Claude Code
//! rather than a terminal, which is why this category's footer differs.

use mainframe_types::setup_advisor::{
    GitHost, ProjectFingerprint, RecommendationCategory, RecommendationProvenance,
};

use super::families::{ANY_ROOT_TOOLING, FRONTEND_FRAMEWORKS, SENSITIVE_APIS};
use super::large_project_evidence;
use crate::setup_advisor::detections::Field;
use crate::setup_advisor::rule::{Evidence, Rule};

/// The suffix that turns a matched dependency label into evidence.
const IN_DEPENDENCIES: &str = "in the project dependencies";

fn no_claude_config(fp: &ProjectFingerprint) -> Option<String> {
    (!fp.has_claude_config).then(|| "no .claude/ or CLAUDE.md at the repo root".to_string())
}

fn claude_config(fp: &ProjectFingerprint) -> Option<String> {
    fp.has_claude_config
        .then(|| "a .claude/ directory or CLAUDE.md at the repo root".to_string())
}

/// Decision 22: the fingerprint reports no host for a worktree checkout, so the
/// two forge rules stay silent there without a second remote-detection path.
fn git_remote(fp: &ProjectFingerprint) -> Option<String> {
    Some(match fp.git_host? {
        GitHost::Github => "a GitHub remote".to_string(),
        GitHost::Gitlab => "a GitLab remote".to_string(),
        GitHost::Other => "a git remote".to_string(),
    })
}

pub static RULES: &[Rule] = &[
    // Manifest-verified name; fires on the absence of any Claude config.
    Rule {
        id: "plugins-claude-code-setup",
        category: RecommendationCategory::Plugins,
        title: "claude-code-setup",
        why: "This project has no Claude config yet; the plugin walks you through the first one.",
        command: "/plugin install claude-code-setup@claude-plugins-official",
        target_path: None,
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 10,
        evidence: Evidence::Custom(no_claude_config),
    },
    // Manifest-verified name. Convex documents a plugin, not an MCP server.
    Rule {
        id: "plugins-convex",
        category: RecommendationCategory::Plugins,
        title: "convex",
        why: "Convex's own plugin: schema, queries, and deploys without leaving the session.",
        command: "/plugin install convex@claude-plugins-official",
        target_path: None,
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 20,
        evidence: Evidence::First(Field::Database, &["convex"], IN_DEPENDENCIES),
    },
    // Manifest-verified name.
    Rule {
        id: "plugins-security-guidance",
        category: RecommendationCategory::Plugins,
        title: "security-guidance",
        why: "Security review rules for the auth and payment code this project already ships.",
        command: "/plugin install security-guidance@claude-plugins-official",
        target_path: None,
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 30,
        evidence: Evidence::First(Field::ExternalApi, SENSITIVE_APIS, IN_DEPENDENCIES),
    },
    // Manifest-verified name.
    Rule {
        id: "plugins-typescript-lsp",
        category: RecommendationCategory::Plugins,
        title: "typescript-lsp",
        why: "Go-to-definition and type-aware search across your TypeScript, instead of grep.",
        command: "/plugin install typescript-lsp@claude-plugins-official",
        target_path: None,
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 40,
        evidence: Evidence::Detected(Field::Language, "typescript", "TypeScript sources detected"),
    },
    // Manifest-verified name.
    Rule {
        id: "plugins-pyright-lsp",
        category: RecommendationCategory::Plugins,
        title: "pyright-lsp",
        why: "Pyright's type information and symbol search across your Python code.",
        command: "/plugin install pyright-lsp@claude-plugins-official",
        target_path: None,
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 40,
        evidence: Evidence::Detected(
            Field::Language,
            "python",
            "a Python project manifest at the repo root",
        ),
    },
    // Manifest-verified name.
    Rule {
        id: "plugins-gopls-lsp",
        category: RecommendationCategory::Plugins,
        title: "gopls-lsp",
        why: "gopls gives Claude real symbol navigation across your Go packages.",
        command: "/plugin install gopls-lsp@claude-plugins-official",
        target_path: None,
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 40,
        evidence: Evidence::Detected(Field::Language, "go", "a go.mod at the repo root"),
    },
    // Manifest-verified name.
    Rule {
        id: "plugins-rust-analyzer-lsp",
        category: RecommendationCategory::Plugins,
        title: "rust-analyzer-lsp",
        why: "rust-analyzer resolves types and traits, so Claude reads your crate like an IDE.",
        command: "/plugin install rust-analyzer-lsp@claude-plugins-official",
        target_path: None,
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 40,
        evidence: Evidence::Detected(Field::Language, "rust", "a Cargo.toml at the repo root"),
    },
    // Manifest-verified name.
    Rule {
        id: "plugins-jdtls-lsp",
        category: RecommendationCategory::Plugins,
        title: "jdtls-lsp",
        why: "Eclipse JDT gives Claude symbol-level navigation of your Java sources.",
        command: "/plugin install jdtls-lsp@claude-plugins-official",
        target_path: None,
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 40,
        evidence: Evidence::Detected(
            Field::Language,
            "java",
            "a Maven or Gradle build file at the repo root",
        ),
    },
    // Manifest-verified name.
    Rule {
        id: "plugins-frontend-design",
        category: RecommendationCategory::Plugins,
        title: "frontend-design",
        why: "Design review and UI generation tuned to the framework you already build on.",
        command: "/plugin install frontend-design@claude-plugins-official",
        target_path: None,
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 50,
        evidence: Evidence::First(Field::Framework, FRONTEND_FRAMEWORKS, IN_DEPENDENCIES),
    },
    // Manifest-verified name.
    Rule {
        id: "plugins-pr-review-toolkit",
        category: RecommendationCategory::Plugins,
        title: "pr-review-toolkit",
        why: "Review a pull request from inside the session instead of switching to the browser.",
        command: "/plugin install pr-review-toolkit@claude-plugins-official",
        target_path: None,
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 60,
        evidence: Evidence::Custom(git_remote),
    },
    // Manifest-verified name.
    Rule {
        id: "plugins-hookify",
        category: RecommendationCategory::Plugins,
        title: "hookify",
        why: "Turns the checks you already run into hooks, without hand-writing settings.json.",
        command: "/plugin install hookify@claude-plugins-official",
        target_path: None,
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 70,
        evidence: ANY_ROOT_TOOLING,
    },
    // Manifest-verified name.
    Rule {
        id: "plugins-code-review",
        category: RecommendationCategory::Plugins,
        title: "code-review",
        why: "Structured review passes for a codebase too large to hold in one head.",
        command: "/plugin install code-review@claude-plugins-official",
        target_path: None,
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 80,
        evidence: Evidence::Custom(large_project_evidence),
    },
    // Manifest-verified name.
    Rule {
        id: "plugins-commit-commands",
        category: RecommendationCategory::Plugins,
        title: "commit-commands",
        why: "Commit messages written from the diff, in the style your history already uses.",
        command: "/plugin install commit-commands@claude-plugins-official",
        target_path: None,
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 90,
        evidence: Evidence::Custom(git_remote),
    },
    // Manifest-verified name.
    Rule {
        id: "plugins-feature-dev",
        category: RecommendationCategory::Plugins,
        title: "feature-dev",
        why: "A guided plan-build-verify loop for features in this codebase.",
        command: "/plugin install feature-dev@claude-plugins-official",
        target_path: None,
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 100,
        evidence: Evidence::Any(Field::Language, "sources in the project"),
    },
    // Manifest-verified name.
    Rule {
        id: "plugins-plugin-dev",
        category: RecommendationCategory::Plugins,
        title: "plugin-dev",
        why: "Scaffolding and validation for the Claude config this project already carries.",
        command: "/plugin install plugin-dev@claude-plugins-official",
        target_path: None,
        adapters: &["claude"],
        provenance: RecommendationProvenance::FirstParty,
        source: None,
        priority: 110,
        evidence: Evidence::Custom(claude_config),
    },
];
