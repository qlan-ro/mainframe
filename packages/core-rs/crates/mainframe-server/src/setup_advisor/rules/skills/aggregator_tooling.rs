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
    aggregator(super::common::RegistryRule {
        id: "skills-drizzle",
        title: "Drizzle ORM patterns",
        why: "Drizzle schema and query patterns, so the migrations stay reviewable.",
        command: "npx skills add bobmatnyc/claude-mpm-skills --skill drizzle-orm -a claude-code -g",
        repo: "bobmatnyc/claude-mpm-skills",
        installs: 4_354,
        priority: 49,
        evidence: Evidence::Detected(
            Field::Database,
            "drizzle",
            "drizzle-orm in package.json dependencies",
        ),
    }),
    // Command: provenance doc, third-party table, `github/awesome-copilot`.
    aggregator(super::common::RegistryRule {
        id: "skills-jest",
        title: "Jest testing patterns",
        why: "Mocking, setup, and assertions that survive the next refactor.",
        command: "npx skills add github/awesome-copilot --skill javascript-typescript-jest -a claude-code -g",
        repo: "github/awesome-copilot",
        installs: 11_922,
        priority: 50,
        evidence: JEST,
    }),
    // Command: provenance doc, third-party table, `github/awesome-copilot`.
    aggregator(super::common::RegistryRule {
        id: "skills-pytest",
        title: "Pytest coverage practice",
        why: "Fixtures and cases that cover behavior rather than lines.",
        command: "npx skills add github/awesome-copilot --skill pytest-coverage -a claude-code -g",
        repo: "github/awesome-copilot",
        installs: 11_881,
        priority: 51,
        evidence: PYTEST,
    }),
    // Command: provenance doc, third-party table, `wshobson/agents`.
    aggregator(super::common::RegistryRule {
        id: "skills-tailwind",
        title: "Tailwind design system",
        why: "Design-system conventions, so utility classes stay consistent across components.",
        command: "npx skills add wshobson/agents --skill tailwind-design-system -a claude-code -g",
        repo: "wshobson/agents",
        installs: 55_916,
        priority: 52,
        evidence: Evidence::Detected(
            Field::Tooling,
            "tailwind",
            "a tailwind.config file at the repo root",
        ),
    }),
    // Command: provenance doc, third-party table, `github/awesome-copilot`.
    aggregator(super::common::RegistryRule {
        id: "skills-docker",
        title: "Multi-stage Dockerfile",
        why: "Multi-stage build practice: smaller images and faster rebuilds.",
        command: "npx skills add github/awesome-copilot --skill multi-stage-dockerfile -a claude-code -g",
        repo: "github/awesome-copilot",
        installs: 18_987,
        priority: 53,
        evidence: Evidence::Detected(
            Field::Tooling,
            "docker",
            "a Dockerfile or docker-compose file at the repo root",
        ),
    }),
    // Command: provenance doc, third-party table, `mindrally/skills`.
    aggregator(super::common::RegistryRule {
        id: "skills-next-auth",
        title: "NextAuth authentication",
        why: "Session and provider wiring for NextAuth, so auth stops being guesswork.",
        command: "npx skills add mindrally/skills --skill nextauth-authentication -a claude-code -g",
        repo: "mindrally/skills",
        installs: 938,
        priority: 54,
        evidence: Evidence::Detected(
            Field::ExternalApi,
            "next-auth",
            "next-auth in package.json dependencies",
        ),
    }),
    // Command: provenance doc, third-party table, `github/awesome-copilot`.
    aggregator(super::common::RegistryRule {
        id: "skills-ruff",
        title: "Ruff recursive fix",
        why: "Ruff fixes applied in an order that converges instead of thrashing.",
        command: "npx skills add github/awesome-copilot --skill ruff-recursive-fix -a claude-code -g",
        repo: "github/awesome-copilot",
        installs: 1_337,
        priority: 55,
        evidence: Evidence::Detected(Field::Tooling, "ruff", "ruff.toml at the repo root"),
    }),
    // Command: provenance doc, third-party table, `patricio0312rev/skills`. The
    // provenance table lists `eslint-prettier-config` once per signal, but both rows
    // are the same skill id and the same command — so this ships as one rule rather
    // than asking the user to install it twice.
    aggregator(super::common::RegistryRule {
        id: "skills-eslint-prettier",
        title: "ESLint and Prettier config",
        why: "One config pair, so the linter and the formatter stop overruling each other.",
        command: "npx skills add patricio0312rev/skills --skill eslint-prettier-config -a claude-code -g",
        repo: "patricio0312rev/skills",
        installs: 898,
        priority: 56,
        evidence: ESLINT_PRETTIER,
    }),
    // Command: provenance doc, third-party table, `oimiragieo/agent-studio`.
    aggregator(super::common::RegistryRule {
        id: "skills-tsconfig",
        title: "tsconfig.json rules",
        why: "A reviewed set of compiler options, so strictness is a decision, not a default.",
        command: "npx skills add oimiragieo/agent-studio --skill tsconfig-json-rules -a claude-code -g",
        repo: "oimiragieo/agent-studio",
        installs: 68,
        priority: 58,
        evidence: Evidence::Detected(Field::Tooling, "tsconfig", "tsconfig.json at the repo root"),
    }),
];
