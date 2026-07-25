//! MCP server recommendations.
//!
//! Detection-to-recommendation mappings come from the upstream `claude-code-setup
//! v1.0.0` plugin (`skills/claude-automation-recommender/references/mcp-servers.md`);
//! every `command` comes from `docs/research/2026-07-25-todo-191-command-provenance.md`,
//! the sole source of truth for this dataset.
//!
//! Two rows in that table ship no rule here: docker (no Claude Code command exists
//! in Docker's documentation) and convex (Convex documents a plugin, not an MCP
//! server, so it lives in `plugins.rs`).
//!
//! `target_path` is `None` throughout. `claude mcp add` owns the file it writes and
//! which file that is depends on `--scope`, so naming one would be a guess.

use mainframe_types::setup_advisor::{
    GitHost, ProjectFingerprint, RecommendationCategory, RecommendationProvenance,
};

use crate::setup_advisor::rule::Rule;

/// Frameworks whose work the Playwright server can actually drive.
const BROWSER_FRAMEWORKS: &[&str] = &["react", "vue", "nextjs"];

/// `Some(evidence)` when `label` is present in `values`. `evidence` is a rule
/// constant: fingerprint content is display data and never reaches a command.
fn detected(values: &[String], label: &str, evidence: &str) -> Option<String> {
    values
        .iter()
        .any(|value| value == label)
        .then(|| evidence.to_string())
}

/// Names the detected label itself. Safe because the fingerprint only ever holds
/// canonical labels from `manifests.rs`, never a raw dependency name.
fn first_of(values: &[String], labels: &[&str]) -> Option<String> {
    labels
        .iter()
        .find(|label| values.iter().any(|value| value == *label))
        .map(|label| format!("{label} detected in this project"))
}

/// Every MCP rule is vendor-official with no `source`: the command installs the
/// vendor's own server, and skills.sh — the only install-count source we have —
/// does not index MCP servers. A fabricated count would be worse than none.
const fn mcp_rule(
    id: &'static str,
    title: &'static str,
    why: &'static str,
    command: &'static str,
    priority: u8,
    evidence: fn(&ProjectFingerprint) -> Option<String>,
) -> Rule {
    Rule {
        id,
        category: RecommendationCategory::Mcp,
        title,
        why,
        command,
        target_path: None,
        adapters: &["*"],
        provenance: RecommendationProvenance::VendorOfficial,
        source: None,
        priority,
        evidence,
    }
}

fn supabase(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.databases,
        "supabase",
        "a @supabase/* dependency in package.json",
    )
}

fn postgres(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.databases,
        "postgres",
        "a pg or postgres dependency in package.json",
    )
}

fn sentry(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.external_apis,
        "sentry",
        "a @sentry/* dependency in package.json",
    )
}

fn aws(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.external_apis,
        "aws",
        "an @aws-sdk/* dependency in package.json",
    )
}

fn browser_framework(fp: &ProjectFingerprint) -> Option<String> {
    first_of(&fp.frameworks, BROWSER_FRAMEWORKS)
}

fn github_remote(fp: &ProjectFingerprint) -> Option<String> {
    matches!(fp.git_host, Some(GitHost::Github)).then(|| "a github.com origin remote".to_string())
}

fn any_framework(fp: &ProjectFingerprint) -> Option<String> {
    let framework = fp.frameworks.first()?;
    Some(format!("{framework} detected in this project"))
}

/// Ranked by how far the signal narrows the recommendation. The two near-universal
/// rules sit last so they cannot crowd out the one server that talks to this
/// project's own database or error stream.
pub static RULES: &[Rule] = &[
    // Command: provenance doc, MCP table, VERIFIED from Supabase's docs.
    mcp_rule(
        "mcp-supabase",
        "Supabase MCP server",
        "Inspect your tables, policies, and rows from the session instead of the dashboard.",
        "claude mcp add --scope project --transport http supabase \"https://mcp.supabase.com/mcp\"",
        1,
        supabase,
    ),
    // Command: provenance doc, MCP table, VERIFIED from code.claude.com/docs/en/mcp.
    mcp_rule(
        "mcp-postgres",
        "Postgres MCP server",
        "Ask about your schema and data directly, instead of pasting query output in.",
        "claude mcp add --transport stdio db -- npx -y @bytebase/dbhub --dsn \"postgresql://USER:PASSWORD@HOST:5432/DATABASE\"",
        2,
        postgres,
    ),
    // Command: provenance doc, MCP table, VERIFIED from code.claude.com/docs/en/mcp
    // and mcp.sentry.dev.
    mcp_rule(
        "mcp-sentry",
        "Sentry MCP server",
        "Go from an alert to the offending line without leaving the session.",
        "claude mcp add --transport http sentry https://mcp.sentry.dev/mcp",
        3,
        sentry,
    ),
    // Command: provenance doc, MCP table, COMPOSED — the `uvx` invocation is from
    // the awslabs README, the wrapper from Anthropic's `--transport stdio` form.
    mcp_rule(
        "mcp-aws",
        "AWS API MCP server",
        "Read your live AWS resources instead of guessing at what is deployed.",
        "claude mcp add --transport stdio aws-api -- uvx awslabs.aws-api-mcp-server@latest",
        4,
        aws,
    ),
    // Command: provenance doc, MCP table, VERIFIED from the Playwright MCP README.
    mcp_rule(
        "mcp-playwright",
        "Playwright MCP server",
        "Let the agent open a real browser and check the UI it just changed.",
        "claude mcp add playwright npx @playwright/mcp@latest",
        5,
        browser_framework,
    ),
    // Command: provenance doc, MCP table, VERIFIED from code.claude.com/docs/en/mcp.
    mcp_rule(
        "mcp-github",
        "GitHub MCP server",
        "Read issues, pull requests, and CI results in the session instead of the browser.",
        "claude mcp add --transport http github https://api.githubcopilot.com/mcp/ --header \"Authorization: Bearer YOUR_GITHUB_PAT\"",
        6,
        github_remote,
    ),
    // Command: provenance doc, MCP table, VERIFIED from upstream SKILL.md:172 plus
    // the context7 docs.
    mcp_rule(
        "mcp-context7",
        "Context7 MCP server",
        "Pull version-accurate library docs into the session instead of trusting recall.",
        "claude mcp add --scope user --header \"CONTEXT7_API_KEY: YOUR_API_KEY\" --transport http context7 https://mcp.context7.com/mcp",
        7,
        any_framework,
    ),
];
