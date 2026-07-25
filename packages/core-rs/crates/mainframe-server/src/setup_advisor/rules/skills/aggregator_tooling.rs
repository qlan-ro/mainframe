//! Third-party skills for the data layer, test runners, and root tooling.
//!
//! Every row is an unaffiliated author's repo, transcribed with its install count
//! from the third-party table in
//! `docs/research/2026-07-25-todo-191-command-provenance.md`. The three lowest-install
//! rows (`prettier`/`eslint` at 898, `tsconfig` at 68) rank last in the category:
//! they are on topic, but at those counts the attribution carries most of the weight.

use mainframe_types::setup_advisor::ProjectFingerprint;

use crate::setup_advisor::rule::Rule;

use super::common::{aggregator, detected};

/// `jest` and `pytest` land in `testing` as a dependency and in `tooling` as a
/// root config file; a project with only the config file still wants the skill.
const JEST_EVIDENCE: &str = "jest in package.json, or a jest.config file at the repo root";
const PYTEST_EVIDENCE: &str =
    "pytest in the project's dependencies, or pytest.ini at the repo root";

fn drizzle(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.databases,
        "drizzle",
        "drizzle-orm in package.json dependencies",
    )
}

fn jest(fp: &ProjectFingerprint) -> Option<String> {
    detected(&fp.testing, "jest", JEST_EVIDENCE)
        .or_else(|| detected(&fp.tooling, "jest", JEST_EVIDENCE))
}

fn pytest(fp: &ProjectFingerprint) -> Option<String> {
    detected(&fp.testing, "pytest", PYTEST_EVIDENCE)
        .or_else(|| detected(&fp.tooling, "pytest", PYTEST_EVIDENCE))
}

fn tailwind(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.tooling,
        "tailwind",
        "a tailwind.config file at the repo root",
    )
}

fn docker(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.tooling,
        "docker",
        "a Dockerfile or docker-compose file at the repo root",
    )
}

fn next_auth(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.external_apis,
        "next-auth",
        "next-auth in package.json dependencies",
    )
}

fn ruff(fp: &ProjectFingerprint) -> Option<String> {
    detected(&fp.tooling, "ruff", "ruff.toml at the repo root")
}

/// One skill covers both configs, so the card names whichever the project has
/// rather than shipping the same install twice. Follows `hooks::linter`.
fn eslint_prettier(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.tooling,
        "eslint",
        "an .eslintrc or eslint.config file at the repo root",
    )
    .or_else(|| {
        detected(
            &fp.tooling,
            "prettier",
            "a .prettierrc or prettier.config file at the repo root",
        )
    })
}

fn tsconfig(fp: &ProjectFingerprint) -> Option<String> {
    detected(&fp.tooling, "tsconfig", "tsconfig.json at the repo root")
}

// Command: provenance doc, third-party table, `bobmatnyc/claude-mpm-skills`.
pub(super) const DRIZZLE: Rule = aggregator(
    "skills-drizzle",
    "Drizzle ORM patterns",
    "Drizzle schema and query patterns, so the migrations stay reviewable.",
    "npx skills add bobmatnyc/claude-mpm-skills --skill drizzle-orm -a claude-code -g -y",
    "bobmatnyc/claude-mpm-skills",
    4_354,
    49,
    drizzle,
);

// Command: provenance doc, third-party table, `github/awesome-copilot`.
pub(super) const JEST: Rule = aggregator(
    "skills-jest",
    "Jest testing patterns",
    "Mocking, setup, and assertions that survive the next refactor.",
    "npx skills add github/awesome-copilot --skill javascript-typescript-jest -a claude-code -g -y",
    "github/awesome-copilot",
    11_922,
    50,
    jest,
);

// Command: provenance doc, third-party table, `github/awesome-copilot`.
pub(super) const PYTEST: Rule = aggregator(
    "skills-pytest",
    "Pytest coverage practice",
    "Fixtures and cases that cover behavior rather than lines.",
    "npx skills add github/awesome-copilot --skill pytest-coverage -a claude-code -g -y",
    "github/awesome-copilot",
    11_881,
    51,
    pytest,
);

// Command: provenance doc, third-party table, `wshobson/agents`.
pub(super) const TAILWIND: Rule = aggregator(
    "skills-tailwind",
    "Tailwind design system",
    "Design-system conventions, so utility classes stay consistent across components.",
    "npx skills add wshobson/agents --skill tailwind-design-system -a claude-code -g -y",
    "wshobson/agents",
    55_916,
    52,
    tailwind,
);

// Command: provenance doc, third-party table, `github/awesome-copilot`.
pub(super) const DOCKER: Rule = aggregator(
    "skills-docker",
    "Multi-stage Dockerfile",
    "Multi-stage build practice: smaller images and faster rebuilds.",
    "npx skills add github/awesome-copilot --skill multi-stage-dockerfile -a claude-code -g -y",
    "github/awesome-copilot",
    18_987,
    53,
    docker,
);

// Command: provenance doc, third-party table, `mindrally/skills`.
pub(super) const NEXT_AUTH: Rule = aggregator(
    "skills-next-auth",
    "NextAuth authentication",
    "Session and provider wiring for NextAuth, so auth stops being guesswork.",
    "npx skills add mindrally/skills --skill nextauth-authentication -a claude-code -g -y",
    "mindrally/skills",
    938,
    54,
    next_auth,
);

// Command: provenance doc, third-party table, `github/awesome-copilot`.
pub(super) const RUFF: Rule = aggregator(
    "skills-ruff",
    "Ruff recursive fix",
    "Ruff fixes applied in an order that converges instead of thrashing.",
    "npx skills add github/awesome-copilot --skill ruff-recursive-fix -a claude-code -g -y",
    "github/awesome-copilot",
    1_337,
    55,
    ruff,
);

// Command: provenance doc, third-party table, `patricio0312rev/skills`. The
// provenance table lists `eslint-prettier-config` once per signal, but both rows
// are the same skill id and the same command — so this ships as one rule rather
// than asking the user to install it twice.
pub(super) const ESLINT_PRETTIER: Rule = aggregator(
    "skills-eslint-prettier",
    "ESLint and Prettier config",
    "One config pair, so the linter and the formatter stop overruling each other.",
    "npx skills add patricio0312rev/skills --skill eslint-prettier-config -a claude-code -g -y",
    "patricio0312rev/skills",
    898,
    56,
    eslint_prettier,
);

// Command: provenance doc, third-party table, `oimiragieo/agent-studio`.
pub(super) const TSCONFIG: Rule = aggregator(
    "skills-tsconfig",
    "tsconfig.json rules",
    "A reviewed set of compiler options, so strictness is a decision, not a default.",
    "npx skills add oimiragieo/agent-studio --skill tsconfig-json-rules -a claude-code -g -y",
    "oimiragieo/agent-studio",
    68,
    58,
    tsconfig,
);
