//! First-party custom-skill scaffolds — the fallback family.
//!
//! `command` is the SKILL.md snippet in `scaffold_bodies.rs`; `target_path` is the
//! file it belongs in. Nothing is fetched, so these are `first-party` with no
//! `source`. They rank last in the category by design: a scaffold should only reach
//! the user when no registry-backed skill matched the project.

use mainframe_types::setup_advisor::{GitHost, ProjectFingerprint};

use crate::setup_advisor::detections::Field;
use crate::setup_advisor::rule::{Evidence, Rule};

use super::super::families::{BACKEND_FRAMEWORKS, FRONTEND_FRAMEWORKS};
use super::common::scaffold;
use super::scaffold_bodies as body;

/// The suffix that turns a matched framework or runner into evidence.
const DETECTED: &str = "detected in this project";

/// A directory and the framework that would fill it are the same fact to the
/// reader: this project has the surface the scaffold generates for.
const TEST_SURFACE: Evidence = Evidence::Either(&[
    Evidence::Detected(Field::Dir, "tests", "a tests/ directory at the repo root"),
    Evidence::First(
        Field::Testing,
        &["vitest", "jest", "playwright", "pytest"],
        DETECTED,
    ),
]);

const COMPONENT_SURFACE: Evidence = Evidence::Either(&[
    Evidence::Detected(
        Field::Dir,
        "components",
        "a components/ directory at the repo root",
    ),
    Evidence::First(Field::Framework, FRONTEND_FRAMEWORKS, DETECTED),
]);

const API_SURFACE: Evidence = Evidence::Either(&[
    Evidence::Detected(Field::Dir, "api", "an api/ directory at the repo root"),
    Evidence::First(Field::Framework, BACKEND_FRAMEWORKS, DETECTED),
]);

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

/// First-party scaffolds, the fallback family.
pub(super) static RULES: &[Rule] = &[
    // Snippet: upstream skills-reference.md, "Project Conventions (Claude-only)".
    scaffold(
        "skills-project-conventions",
        "Project conventions skill",
        "A template for the conventions the agent should apply to every file it touches, without being asked.",
        body::PROJECT_CONVENTIONS,
        ".claude/skills/project-conventions/SKILL.md",
        80,
        Evidence::Any(Field::Language, DETECTED),
    ),
    // Snippet: upstream skills-reference.md, "Test Generator with Examples".
    scaffold(
        "skills-gen-test",
        "Test generator skill",
        "Generate tests that follow your existing suites instead of a generic template.",
        body::GEN_TEST,
        ".claude/skills/gen-test/SKILL.md",
        81,
        TEST_SURFACE,
    ),
    // Snippet: upstream skills-reference.md, "Component Generator with Template".
    scaffold(
        "skills-new-component",
        "Component generator skill",
        "Scaffold a component with its test and story, patterned on the ones you already have.",
        body::NEW_COMPONENT,
        ".claude/skills/new-component/SKILL.md",
        82,
        COMPONENT_SURFACE,
    ),
    // Snippet: upstream skills-reference.md, "API Documentation with OpenAPI Template".
    scaffold(
        "skills-api-doc",
        "API documentation skill",
        "Turn an endpoint into OpenAPI docs that match the ones your repo already has.",
        body::API_DOC,
        ".claude/skills/api-doc/SKILL.md",
        83,
        API_SURFACE,
    ),
    // Snippet: upstream skills-reference.md, "Database Migration Generator with Script".
    scaffold(
        "skills-create-migration",
        "Migration generator skill",
        "One step for the migration file and the down direction people forget to write.",
        body::CREATE_MIGRATION,
        ".claude/skills/create-migration/SKILL.md",
        84,
        Evidence::Any(Field::Database, "detected as this project's data layer"),
    ),
    // Snippet: upstream skills-reference.md, "PR Review with Checklist".
    scaffold(
        "skills-pr-check",
        "PR checklist skill",
        "Review every pull request against a checklist in your repo instead of remembering it.",
        body::PR_CHECK,
        ".claude/skills/pr-check/SKILL.md",
        85,
        Evidence::Custom(github_remote),
    ),
    // Snippet: upstream skills-reference.md, "Release Notes Generator".
    scaffold(
        "skills-release-notes",
        "Release notes skill",
        "Turn the commits since your last tag into notes a user can read.",
        body::RELEASE_NOTES,
        ".claude/skills/release-notes/SKILL.md",
        86,
        Evidence::Custom(git_remote),
    ),
    // Snippet: upstream skills-reference.md, "Environment Setup".
    scaffold(
        "skills-setup-dev",
        "Dev environment setup skill",
        "One skill that walks a new contributor through the whole setup.",
        body::SETUP_DEV,
        ".claude/skills/setup-dev/SKILL.md",
        87,
        Evidence::Custom(bootstrap_surface),
    ),
];
