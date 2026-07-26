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
    aggregator(
        "skills-typescript",
        "Advanced TypeScript types",
        "Typing patterns for the places where inference gives up and the errors get long.",
        "npx skills add wshobson/agents --skill typescript-advanced-types -a claude-code -g",
        "wshobson/agents",
        55_514,
        40,
        Evidence::Detected(
            Field::Language,
            "typescript",
            "tsconfig.json at the repo root, or typescript in package.json",
        ),
    ),
    // Command: provenance doc, third-party table, `wshobson/agents`.
    aggregator(
        "skills-python",
        "Python performance optimization",
        "Profiling and optimization patterns for the hot paths, not micro-tweaks.",
        "npx skills add wshobson/agents --skill python-performance-optimization -a claude-code -g",
        "wshobson/agents",
        29_714,
        41,
        Evidence::Detected(
            Field::Language,
            "python",
            "a Python project manifest at the repo root",
        ),
    ),
    // Command: provenance doc, third-party table, `wshobson/agents`.
    aggregator(
        "skills-rust",
        "Rust async patterns",
        "Async Rust patterns — the part the compiler will not teach you.",
        "npx skills add wshobson/agents --skill rust-async-patterns -a claude-code -g",
        "wshobson/agents",
        16_153,
        42,
        Evidence::Detected(Field::Language, "rust", "Cargo.toml at the repo root"),
    ),
    // Command: provenance doc, third-party table, `samber/cc-skills-golang`.
    aggregator(
        "skills-golang",
        "Go code style",
        "A Go style guide the agent applies while writing, rather than at review time.",
        "npx skills add samber/cc-skills-golang --skill golang-code-style -a claude-code -g",
        "samber/cc-skills-golang",
        35_764,
        43,
        Evidence::Detected(Field::Language, "go", "go.mod at the repo root"),
    ),
    // Command: provenance doc, third-party table, `github/awesome-copilot`.
    aggregator(
        "skills-java",
        "Java Spring Boot patterns",
        "Spring Boot conventions applied as the agent writes controllers and services.",
        "npx skills add github/awesome-copilot --skill java-springboot -a claude-code -g",
        "github/awesome-copilot",
        18_370,
        44,
        Evidence::Detected(
            Field::Language,
            "java",
            "a Maven or Gradle build file at the repo root",
        ),
    ),
    // Command: provenance doc, third-party table, `wshobson/agents`.
    aggregator(
        "skills-nextjs",
        "Next.js App Router patterns",
        "Server components, layouts, and data fetching done the way the App Router expects.",
        "npx skills add wshobson/agents --skill nextjs-app-router-patterns -a claude-code -g",
        "wshobson/agents",
        25_370,
        45,
        Evidence::Detected(
            Field::Framework,
            "nextjs",
            "next in package.json dependencies",
        ),
    ),
    // Command: provenance doc, third-party table, `analogjs/angular-skills` — an
    // Angular-ecosystem org, not the Angular team, so this stays third-party.
    aggregator(
        "skills-angular",
        "Angular component patterns",
        "Angular component conventions applied while the agent scaffolds.",
        "npx skills add analogjs/angular-skills --skill angular-component -a claude-code -g",
        "analogjs/angular-skills",
        9_848,
        46,
        Evidence::Detected(
            Field::Framework,
            "angular",
            "@angular/core in package.json dependencies",
        ),
    ),
    // Command: provenance doc, third-party table, `aj-geddes/useful-ai-prompts`.
    aggregator(
        "skills-express",
        "Express server patterns",
        "Routing, middleware order, and error handling that hold up past the first route.",
        "npx skills add aj-geddes/useful-ai-prompts --skill nodejs-express-server -a claude-code -g",
        "aj-geddes/useful-ai-prompts",
        2_990,
        47,
        Evidence::Detected(
            Field::Framework,
            "express",
            "express in package.json dependencies",
        ),
    ),
    // Command: provenance doc, third-party table, `affaan-m/everything-claude-code`.
    aggregator(
        "skills-django",
        "Django patterns",
        "Django app, model, and view conventions applied as the agent writes.",
        "npx skills add affaan-m/everything-claude-code --skill django-patterns -a claude-code -g",
        "affaan-m/everything-claude-code",
        7_357,
        48,
        Evidence::Detected(
            Field::Framework,
            "django",
            "django in the project's Python dependencies",
        ),
    ),
];
