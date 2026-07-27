//! One firing case per shipped rule.
//!
//! `every_rule_declares_the_signal_it_fires_on` is the point of the file: a new
//! rule that lands without a row here fails, so no rule can ship with nobody
//! having stated — in a form the test can check — what earns it.

use mainframe_types::setup_advisor::{GitHost, ProjectFingerprint};

use super::super::all;

/// The single signal a rule claims to need, in the field it reads it from.
#[derive(Debug, Clone, Copy)]
enum Signal {
    Language(&'static str),
    Framework(&'static str),
    Database(&'static str),
    ExternalApi(&'static str),
    Testing(&'static str),
    Tooling(&'static str),
    Dir(&'static str),
    Remote(GitHost),
    Files(u64),
    ClaudeConfig,
    /// The default fingerprint: what a rule that fires on an absence needs.
    Nothing,
    LockFile,
    EnvFile,
}

fn fingerprint_for(signal: Signal) -> ProjectFingerprint {
    let one = |value: &str| vec![value.to_string()];
    let mut fp = ProjectFingerprint::default();
    match signal {
        Signal::Language(value) => fp.languages = one(value),
        Signal::Framework(value) => fp.frameworks = one(value),
        Signal::Database(value) => fp.databases = one(value),
        Signal::ExternalApi(value) => fp.external_apis = one(value),
        Signal::Testing(value) => fp.testing = one(value),
        Signal::Tooling(value) => fp.tooling = one(value),
        Signal::Dir(value) => fp.dirs = one(value),
        Signal::Remote(host) => fp.git_host = Some(host),
        Signal::Files(count) => fp.file_count = count,
        Signal::ClaudeConfig => fp.has_claude_config = true,
        Signal::Nothing => {}
        Signal::LockFile => fp.has_lock_files = true,
        Signal::EnvFile => fp.has_env_files = true,
    }
    fp
}

const CASES: &[(&str, Signal)] = &[
    ("mcp-supabase", Signal::Database("supabase")),
    ("mcp-postgres", Signal::Database("postgres")),
    ("mcp-sentry", Signal::ExternalApi("sentry")),
    ("mcp-aws", Signal::ExternalApi("aws")),
    ("mcp-playwright", Signal::Framework("react")),
    ("mcp-github", Signal::Remote(GitHost::Github)),
    ("mcp-context7", Signal::Framework("react")),
    ("skills-react", Signal::Framework("react")),
    ("skills-vue", Signal::Framework("vue")),
    ("skills-svelte", Signal::Framework("svelte")),
    ("skills-fastapi", Signal::Framework("fastapi")),
    ("skills-supabase", Signal::Database("supabase")),
    ("skills-postgres", Signal::Database("postgres")),
    ("skills-prisma", Signal::Database("prisma")),
    ("skills-convex", Signal::Database("convex")),
    ("skills-vitest", Signal::Testing("vitest")),
    ("skills-playwright", Signal::Testing("playwright")),
    ("skills-stripe", Signal::ExternalApi("stripe")),
    ("skills-clerk", Signal::ExternalApi("clerk")),
    ("skills-auth0", Signal::ExternalApi("auth0")),
    ("skills-langchain", Signal::ExternalApi("langchain")),
    ("skills-openai", Signal::ExternalApi("openai")),
    ("skills-aws", Signal::ExternalApi("aws")),
    ("skills-sentry", Signal::ExternalApi("sentry")),
    ("skills-typescript", Signal::Language("typescript")),
    ("skills-python", Signal::Language("python")),
    ("skills-rust", Signal::Language("rust")),
    ("skills-golang", Signal::Language("go")),
    ("skills-java", Signal::Language("java")),
    ("skills-nextjs", Signal::Framework("nextjs")),
    ("skills-angular", Signal::Framework("angular")),
    ("skills-express", Signal::Framework("express")),
    ("skills-django", Signal::Framework("django")),
    ("skills-drizzle", Signal::Database("drizzle")),
    ("skills-jest", Signal::Testing("jest")),
    ("skills-pytest", Signal::Testing("pytest")),
    ("skills-tailwind", Signal::Tooling("tailwind")),
    ("skills-docker", Signal::Tooling("docker")),
    ("skills-next-auth", Signal::ExternalApi("next-auth")),
    ("skills-ruff", Signal::Tooling("ruff")),
    ("skills-eslint-prettier", Signal::Tooling("eslint")),
    ("skills-tsconfig", Signal::Tooling("tsconfig")),
    ("skills-project-conventions", Signal::Language("rust")),
    ("skills-gen-test", Signal::Dir("tests")),
    ("skills-new-component", Signal::Dir("components")),
    ("skills-api-doc", Signal::Dir("api")),
    ("skills-create-migration", Signal::Database("postgres")),
    ("skills-pr-check", Signal::Remote(GitHost::Github)),
    ("skills-release-notes", Signal::Remote(GitHost::Other)),
    ("skills-setup-dev", Signal::LockFile),
    ("hooks-block-edits", Signal::EnvFile),
    ("hooks-format-on-edit", Signal::Tooling("prettier")),
    ("hooks-lint-on-edit", Signal::Tooling("eslint")),
    ("hooks-typecheck-on-edit", Signal::Tooling("tsconfig")),
    ("hooks-run-related-tests", Signal::Testing("vitest")),
    ("subagents-security-reviewer", Signal::ExternalApi("stripe")),
    ("subagents-test-writer", Signal::Language("rust")),
    ("subagents-code-reviewer", Signal::Files(501)),
    (
        "subagents-performance-analyzer",
        Signal::Database("postgres"),
    ),
    ("subagents-api-documenter", Signal::Dir("api")),
    ("subagents-ui-reviewer", Signal::Framework("react")),
    ("plugins-claude-code-setup", Signal::Nothing),
    ("plugins-convex", Signal::Database("convex")),
    ("plugins-security-guidance", Signal::ExternalApi("stripe")),
    ("plugins-typescript-lsp", Signal::Language("typescript")),
    ("plugins-pyright-lsp", Signal::Language("python")),
    ("plugins-gopls-lsp", Signal::Language("go")),
    ("plugins-rust-analyzer-lsp", Signal::Language("rust")),
    ("plugins-jdtls-lsp", Signal::Language("java")),
    ("plugins-frontend-design", Signal::Framework("react")),
    ("plugins-pr-review-toolkit", Signal::Remote(GitHost::Other)),
    ("plugins-hookify", Signal::Tooling("prettier")),
    ("plugins-code-review", Signal::Files(501)),
    ("plugins-commit-commands", Signal::Remote(GitHost::Other)),
    ("plugins-feature-dev", Signal::Language("rust")),
    ("plugins-plugin-dev", Signal::ClaudeConfig),
];

#[test]
fn every_rule_declares_the_signal_it_fires_on() {
    let declared: Vec<&str> = CASES.iter().map(|(id, _)| *id).collect();

    let undeclared: Vec<&str> = all()
        .iter()
        .map(|rule| rule.id)
        .filter(|id| !declared.contains(id))
        .collect();
    assert!(
        undeclared.is_empty(),
        "these rules ship with no stated firing signal: {undeclared:?}"
    );

    let ids: Vec<&str> = all().iter().map(|rule| rule.id).collect();
    let stale: Vec<&&str> = declared.iter().filter(|id| !ids.contains(id)).collect();
    assert!(stale.is_empty(), "these cases name no rule: {stale:?}");
}

#[test]
fn each_rule_fires_on_the_signal_it_declares() {
    let dataset = all();
    for (id, signal) in CASES {
        let rule = dataset
            .iter()
            .find(|rule| rule.id == *id)
            .unwrap_or_else(|| panic!("no rule `{id}`"));
        let fp = fingerprint_for(*signal);

        assert!(
            rule.evaluate(&fp).is_some(),
            "{id} did not fire on {signal:?}"
        );
    }
}

/// The evidence string is what the card shows under "why this project". An empty
/// one renders a blank line, and a rule that fires with nothing to say should
/// not have fired.
#[test]
fn every_firing_rule_has_something_concrete_to_show_for_it() {
    let dataset = all();
    for (id, signal) in CASES {
        let rule = dataset.iter().find(|rule| rule.id == *id).unwrap();

        let evidence = rule.evaluate(&fingerprint_for(*signal)).unwrap();
        assert!(
            !evidence.trim().is_empty(),
            "{id} fired with empty evidence"
        );
    }
}

/// A project with nothing detected has earned exactly one card: the one that
/// fires on the absence of a Claude config. Any other rule reaching this list
/// fires on no evidence at all.
#[test]
fn a_fingerprint_with_no_detections_earns_only_the_setup_plugin() {
    let empty = ProjectFingerprint::default();

    let fired: Vec<&str> = all()
        .into_iter()
        .filter(|rule| rule.evaluate(&empty).is_some())
        .map(|rule| rule.id)
        .collect();

    assert_eq!(fired, vec!["plugins-claude-code-setup"]);
}
