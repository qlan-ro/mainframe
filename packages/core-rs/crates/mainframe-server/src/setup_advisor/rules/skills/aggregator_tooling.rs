//! Third-party skills for the data layer, test runners, and root tooling.
//!
//! Every row is an unaffiliated author's repo, transcribed with its install count
//! from the third-party table in
//! `docs/research/2026-07-25-todo-191-command-provenance.md`. The three lowest-install
//! rows (`prettier`/`eslint` at 898, `tsconfig` at 68) rank last in the category:
//! they are on topic, but at those counts the attribution carries most of the weight.

use crate::setup_advisor::detections::Field;
use crate::setup_advisor::rule::{Evidence, Rule};

use super::common::aggregator;

/// `jest` and `pytest` land in `testing` as a dependency and in `tooling` as a
/// root config file; a project with only the config file still wants the skill.
const JEST_EVIDENCE: &str = "jest in package.json, or a jest.config file at the repo root";
const PYTEST_EVIDENCE: &str =
    "pytest in the project's dependencies, or pytest.ini at the repo root";

const JEST: Evidence = Evidence::Either(&[
    Evidence::Detected(Field::Testing, "jest", JEST_EVIDENCE),
    Evidence::Detected(Field::Tooling, "jest", JEST_EVIDENCE),
]);
const PYTEST: Evidence = Evidence::Either(&[
    Evidence::Detected(Field::Testing, "pytest", PYTEST_EVIDENCE),
    Evidence::Detected(Field::Tooling, "pytest", PYTEST_EVIDENCE),
]);

/// One skill covers both configs, so the card names whichever the project has
/// rather than shipping the same install twice. Follows `hooks::LINTER`.
const ESLINT_PRETTIER: Evidence = Evidence::Either(&[
    Evidence::Detected(
        Field::Tooling,
        "eslint",
        "an .eslintrc or eslint.config file at the repo root",
    ),
    Evidence::Detected(
        Field::Tooling,
        "prettier",
        "a .prettierrc or prettier.config file at the repo root",
    ),
]);

/// Third-party skills for the data layer, test runners, and root tooling.
pub(super) static RULES: &[Rule] = &[
    // Command: provenance doc, third-party table, `bobmatnyc/claude-mpm-skills`.
    aggregator(
        "skills-drizzle",
        "Drizzle ORM patterns",
        "Drizzle schema and query patterns, so the migrations stay reviewable.",
        "npx skills add bobmatnyc/claude-mpm-skills --skill drizzle-orm -a claude-code -g",
        "bobmatnyc/claude-mpm-skills",
        4_354,
        49,
        Evidence::Detected(
            Field::Database,
            "drizzle",
            "drizzle-orm in package.json dependencies",
        ),
    ),
    // Command: provenance doc, third-party table, `github/awesome-copilot`.
    aggregator(
        "skills-jest",
        "Jest testing patterns",
        "Mocking, setup, and assertions that survive the next refactor.",
        "npx skills add github/awesome-copilot --skill javascript-typescript-jest -a claude-code -g",
        "github/awesome-copilot",
        11_922,
        50,
        JEST,
    ),
    // Command: provenance doc, third-party table, `github/awesome-copilot`.
    aggregator(
        "skills-pytest",
        "Pytest coverage practice",
        "Fixtures and cases that cover behavior rather than lines.",
        "npx skills add github/awesome-copilot --skill pytest-coverage -a claude-code -g",
        "github/awesome-copilot",
        11_881,
        51,
        PYTEST,
    ),
    // Command: provenance doc, third-party table, `wshobson/agents`.
    aggregator(
        "skills-tailwind",
        "Tailwind design system",
        "Design-system conventions, so utility classes stay consistent across components.",
        "npx skills add wshobson/agents --skill tailwind-design-system -a claude-code -g",
        "wshobson/agents",
        55_916,
        52,
        Evidence::Detected(
            Field::Tooling,
            "tailwind",
            "a tailwind.config file at the repo root",
        ),
    ),
    // Command: provenance doc, third-party table, `github/awesome-copilot`.
    aggregator(
        "skills-docker",
        "Multi-stage Dockerfile",
        "Multi-stage build practice: smaller images and faster rebuilds.",
        "npx skills add github/awesome-copilot --skill multi-stage-dockerfile -a claude-code -g",
        "github/awesome-copilot",
        18_987,
        53,
        Evidence::Detected(
            Field::Tooling,
            "docker",
            "a Dockerfile or docker-compose file at the repo root",
        ),
    ),
    // Command: provenance doc, third-party table, `mindrally/skills`.
    aggregator(
        "skills-next-auth",
        "NextAuth authentication",
        "Session and provider wiring for NextAuth, so auth stops being guesswork.",
        "npx skills add mindrally/skills --skill nextauth-authentication -a claude-code -g",
        "mindrally/skills",
        938,
        54,
        Evidence::Detected(
            Field::ExternalApi,
            "next-auth",
            "next-auth in package.json dependencies",
        ),
    ),
    // Command: provenance doc, third-party table, `github/awesome-copilot`.
    aggregator(
        "skills-ruff",
        "Ruff recursive fix",
        "Ruff fixes applied in an order that converges instead of thrashing.",
        "npx skills add github/awesome-copilot --skill ruff-recursive-fix -a claude-code -g",
        "github/awesome-copilot",
        1_337,
        55,
        Evidence::Detected(Field::Tooling, "ruff", "ruff.toml at the repo root"),
    ),
    // Command: provenance doc, third-party table, `patricio0312rev/skills`. The
    // provenance table lists `eslint-prettier-config` once per signal, but both rows
    // are the same skill id and the same command — so this ships as one rule rather
    // than asking the user to install it twice.
    aggregator(
        "skills-eslint-prettier",
        "ESLint and Prettier config",
        "One config pair, so the linter and the formatter stop overruling each other.",
        "npx skills add patricio0312rev/skills --skill eslint-prettier-config -a claude-code -g",
        "patricio0312rev/skills",
        898,
        56,
        ESLINT_PRETTIER,
    ),
    // Command: provenance doc, third-party table, `oimiragieo/agent-studio`.
    aggregator(
        "skills-tsconfig",
        "tsconfig.json rules",
        "A reviewed set of compiler options, so strictness is a decision, not a default.",
        "npx skills add oimiragieo/agent-studio --skill tsconfig-json-rules -a claude-code -g",
        "oimiragieo/agent-studio",
        68,
        58,
        Evidence::Detected(Field::Tooling, "tsconfig", "tsconfig.json at the repo root"),
    ),
];
