//! First-party custom-skill scaffolds — the fallback family.
//!
//! `command` is the SKILL.md snippet in `scaffold_bodies.rs`; `target_path` is the
//! file it belongs in. Nothing is fetched, so these are `first-party` with no
//! `source`. They rank last in the category by design: a scaffold should only reach
//! the user when no registry-backed skill matched the project.

use mainframe_types::setup_advisor::{GitHost, ProjectFingerprint};

use crate::setup_advisor::rule::Rule;

use super::common::{detected, first_of, scaffold};
use super::scaffold_bodies as body;

/// Frameworks whose components a scaffold would generate.
const FRONTEND: &[&str] = &["react", "nextjs", "vue", "angular", "svelte"];

/// Frameworks that serve an HTTP API worth documenting.
const BACKEND: &[&str] = &["express", "fastapi", "django"];

fn any_language(fp: &ProjectFingerprint) -> Option<String> {
    let language = fp.languages.first()?;
    Some(format!("{language} detected in this project"))
}

fn test_surface(fp: &ProjectFingerprint) -> Option<String> {
    detected(&fp.dirs, "tests", "a tests/ directory at the repo root")
        .or_else(|| first_of(&fp.testing, &["vitest", "jest", "playwright", "pytest"]))
}

fn component_surface(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.dirs,
        "components",
        "a components/ directory at the repo root",
    )
    .or_else(|| first_of(&fp.frameworks, FRONTEND))
}

fn api_surface(fp: &ProjectFingerprint) -> Option<String> {
    detected(&fp.dirs, "api", "an api/ directory at the repo root")
        .or_else(|| first_of(&fp.frameworks, BACKEND))
}

fn data_layer(fp: &ProjectFingerprint) -> Option<String> {
    let database = fp.databases.first()?;
    Some(format!("{database} detected as this project's data layer"))
}

fn github_remote(fp: &ProjectFingerprint) -> Option<String> {
    matches!(fp.git_host, Some(GitHost::Github)).then(|| "a github.com origin remote".to_string())
}

fn git_remote(fp: &ProjectFingerprint) -> Option<String> {
    fp.git_host
        .map(|_| "an origin remote in .git/config".to_string())
}

fn bootstrap_surface(fp: &ProjectFingerprint) -> Option<String> {
    if fp.has_lock_files {
        return Some("a dependency lockfile at the repo root".to_string());
    }
    fp.has_env_files
        .then(|| "a .env file at the repo root".to_string())
}

// Snippet: upstream skills-reference.md, "Project Conventions (Claude-only)".
pub(super) const PROJECT_CONVENTIONS: Rule = scaffold(
    "skills-project-conventions",
    "Project conventions skill",
    "Background knowledge the agent applies to every file it touches, without being asked.",
    body::PROJECT_CONVENTIONS,
    ".claude/skills/project-conventions/SKILL.md",
    80,
    any_language,
);

// Snippet: upstream skills-reference.md, "Test Generator with Examples".
pub(super) const GEN_TEST: Rule = scaffold(
    "skills-gen-test",
    "Test generator skill",
    "Generate tests that follow your existing suites instead of a generic template.",
    body::GEN_TEST,
    ".claude/skills/gen-test/SKILL.md",
    81,
    test_surface,
);

// Snippet: upstream skills-reference.md, "Component Generator with Template".
pub(super) const NEW_COMPONENT: Rule = scaffold(
    "skills-new-component",
    "Component generator skill",
    "Scaffold a component with its test and story from templates you control.",
    body::NEW_COMPONENT,
    ".claude/skills/new-component/SKILL.md",
    82,
    component_surface,
);

// Snippet: upstream skills-reference.md, "API Documentation with OpenAPI Template".
pub(super) const API_DOC: Rule = scaffold(
    "skills-api-doc",
    "API documentation skill",
    "Turn an endpoint into OpenAPI docs from a template you control.",
    body::API_DOC,
    ".claude/skills/api-doc/SKILL.md",
    83,
    api_surface,
);

// Snippet: upstream skills-reference.md, "Database Migration Generator with Script".
pub(super) const CREATE_MIGRATION: Rule = scaffold(
    "skills-create-migration",
    "Migration generator skill",
    "One step for the migration file and the validation that has to follow it.",
    body::CREATE_MIGRATION,
    ".claude/skills/create-migration/SKILL.md",
    84,
    data_layer,
);

// Snippet: upstream skills-reference.md, "PR Review with Checklist".
pub(super) const PR_CHECK: Rule = scaffold(
    "skills-pr-check",
    "PR checklist skill",
    "Review every pull request against your checklist instead of remembering it.",
    body::PR_CHECK,
    ".claude/skills/pr-check/SKILL.md",
    85,
    github_remote,
);

// Snippet: upstream skills-reference.md, "Release Notes Generator".
pub(super) const RELEASE_NOTES: Rule = scaffold(
    "skills-release-notes",
    "Release notes skill",
    "Turn the commits since your last tag into notes a user can read.",
    body::RELEASE_NOTES,
    ".claude/skills/release-notes/SKILL.md",
    86,
    git_remote,
);

// Snippet: upstream skills-reference.md, "Environment Setup".
pub(super) const SETUP_DEV: Rule = scaffold(
    "skills-setup-dev",
    "Dev environment setup skill",
    "One skill that walks a new contributor through the whole setup.",
    body::SETUP_DEV,
    ".claude/skills/setup-dev/SKILL.md",
    87,
    bootstrap_surface,
);
