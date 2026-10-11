//! Third-party skills for languages and application frameworks.
//!
//! No vendor publishes a skill for any of these signals — there is no `rust-lang/`,
//! `python/`, `expressjs/`, or `django/` owner in the registry. Every row here is an
//! unaffiliated author's repo, transcribed with its install count from the
//! third-party table in `docs/research/2026-07-25-todo-191-command-provenance.md` so
//! the user can see whose content the command installs.

use crate::setup_advisor::detections::Field;
use crate::setup_advisor::rule::{Evidence, Rule};

use super::common::aggregator;

/// Third-party skills for languages and application frameworks.
pub(super) static RULES: &[Rule] = &[
    // Command: provenance doc, third-party table, `wshobson/agents`.
    aggregator(super::common::RegistryRule {
        id: "skills-typescript",
        title: "Advanced TypeScript types",
        why: "Typing patterns for the places where inference gives up and the errors get long.",
        command: "npx skills add wshobson/agents --skill typescript-advanced-types -a claude-code -g",
        repo: "wshobson/agents",
        installs: 55_514,
        priority: 40,
        evidence: Evidence::Detected(
            Field::Language,
            "typescript",
            "tsconfig.json at the repo root, or typescript in package.json",
        ),
    }),
    // Command: provenance doc, third-party table, `wshobson/agents`.
    aggregator(super::common::RegistryRule {
        id: "skills-python",
        title: "Python performance optimization",
        why: "Profiling and optimization patterns for the hot paths, not micro-tweaks.",
        command: "npx skills add wshobson/agents --skill python-performance-optimization -a claude-code -g",
        repo: "wshobson/agents",
        installs: 29_714,
        priority: 41,
        evidence: Evidence::Detected(
            Field::Language,
            "python",
            "a Python project manifest at the repo root",
        ),
    }),
    // Command: provenance doc, third-party table, `wshobson/agents`.
    aggregator(super::common::RegistryRule {
        id: "skills-rust",
        title: "Rust async patterns",
        why: "Async Rust patterns — the part the compiler will not teach you.",
        command: "npx skills add wshobson/agents --skill rust-async-patterns -a claude-code -g",
        repo: "wshobson/agents",
        installs: 16_153,
        priority: 42,
        evidence: Evidence::Detected(Field::Language, "rust", "Cargo.toml at the repo root"),
    }),
    // Command: provenance doc, third-party table, `samber/cc-skills-golang`.
    aggregator(super::common::RegistryRule {
        id: "skills-golang",
        title: "Go code style",
        why: "A Go style guide the agent applies while writing, rather than at review time.",
        command: "npx skills add samber/cc-skills-golang --skill golang-code-style -a claude-code -g",
        repo: "samber/cc-skills-golang",
        installs: 35_764,
        priority: 43,
        evidence: Evidence::Detected(Field::Language, "go", "go.mod at the repo root"),
    }),
    // Command: provenance doc, third-party table, `github/awesome-copilot`.
    aggregator(super::common::RegistryRule {
        id: "skills-java",
        title: "Java Spring Boot patterns",
        why: "Spring Boot conventions applied as the agent writes controllers and services.",
        command: "npx skills add github/awesome-copilot --skill java-springboot -a claude-code -g",
        repo: "github/awesome-copilot",
        installs: 18_370,
        priority: 44,
        evidence: Evidence::Detected(
            Field::Language,
            "java",
            "a Maven or Gradle build file at the repo root",
        ),
    }),
    // Command: provenance doc, third-party table, `wshobson/agents`.
    aggregator(super::common::RegistryRule {
        id: "skills-nextjs",
        title: "Next.js App Router patterns",
        why: "Server components, layouts, and data fetching done the way the App Router expects.",
        command: "npx skills add wshobson/agents --skill nextjs-app-router-patterns -a claude-code -g",
        repo: "wshobson/agents",
        installs: 25_370,
        priority: 45,
        evidence: Evidence::Detected(
            Field::Framework,
            "nextjs",
            "next in package.json dependencies",
        ),
    }),
    // Command: provenance doc, third-party table, `analogjs/angular-skills` — an
    // Angular-ecosystem org, not the Angular team, so this stays third-party.
    aggregator(super::common::RegistryRule {
        id: "skills-angular",
        title: "Angular component patterns",
        why: "Angular component conventions applied while the agent scaffolds.",
        command: "npx skills add analogjs/angular-skills --skill angular-component -a claude-code -g",
        repo: "analogjs/angular-skills",
        installs: 9_848,
        priority: 46,
        evidence: Evidence::Detected(
            Field::Framework,
            "angular",
            "@angular/core in package.json dependencies",
        ),
    }),
    // Command: provenance doc, third-party table, `aj-geddes/useful-ai-prompts`.
    aggregator(super::common::RegistryRule {
        id: "skills-express",
        title: "Express server patterns",
        why: "Routing, middleware order, and error handling that hold up past the first route.",
        command: "npx skills add aj-geddes/useful-ai-prompts --skill nodejs-express-server -a claude-code -g",
        repo: "aj-geddes/useful-ai-prompts",
        installs: 2_990,
        priority: 47,
        evidence: Evidence::Detected(
            Field::Framework,
            "express",
            "express in package.json dependencies",
        ),
    }),
    // Command: provenance doc, third-party table, `affaan-m/everything-claude-code`.
    aggregator(super::common::RegistryRule {
        id: "skills-django",
        title: "Django patterns",
        why: "Django app, model, and view conventions applied as the agent writes.",
        command: "npx skills add affaan-m/everything-claude-code --skill django-patterns -a claude-code -g",
        repo: "affaan-m/everything-claude-code",
        installs: 7_357,
        priority: 48,
        evidence: Evidence::Detected(
            Field::Framework,
            "django",
            "django in the project's Python dependencies",
        ),
    }),
];
