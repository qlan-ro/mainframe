//! Third-party skills for languages and application frameworks.
//!
//! No vendor publishes a skill for any of these signals — there is no `rust-lang/`,
//! `python/`, `expressjs/`, or `django/` owner in the registry. Every row here is an
//! unaffiliated author's repo, transcribed with its install count from the
//! third-party table in `docs/research/2026-07-25-todo-191-command-provenance.md` so
//! the user can see whose content the command installs.

use mainframe_types::setup_advisor::ProjectFingerprint;

use crate::setup_advisor::rule::Rule;

use super::common::{aggregator, detected};

fn typescript(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.languages,
        "typescript",
        "tsconfig.json at the repo root, or typescript in package.json",
    )
}

fn python(fp: &ProjectFingerprint) -> Option<String> {
    detected(&fp.languages, "python", "pyproject.toml at the repo root")
}

fn rust(fp: &ProjectFingerprint) -> Option<String> {
    detected(&fp.languages, "rust", "Cargo.toml at the repo root")
}

fn golang(fp: &ProjectFingerprint) -> Option<String> {
    detected(&fp.languages, "go", "go.mod at the repo root")
}

fn java(fp: &ProjectFingerprint) -> Option<String> {
    detected(&fp.languages, "java", "pom.xml at the repo root")
}

fn nextjs(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.frameworks,
        "nextjs",
        "next in package.json dependencies",
    )
}

fn angular(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.frameworks,
        "angular",
        "@angular/core in package.json dependencies",
    )
}

fn express(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.frameworks,
        "express",
        "express in package.json dependencies",
    )
}

fn django(fp: &ProjectFingerprint) -> Option<String> {
    detected(
        &fp.frameworks,
        "django",
        "django in the project's Python dependencies",
    )
}

// Command: provenance doc, third-party table, `wshobson/agents`.
pub(super) const TYPESCRIPT: Rule = aggregator(
    "skills-typescript",
    "Advanced TypeScript types",
    "Typing patterns for the places where inference gives up and the errors get long.",
    "npx skills add wshobson/agents --skill typescript-advanced-types -a claude-code -g -y",
    "wshobson/agents",
    55_514,
    40,
    typescript,
);

// Command: provenance doc, third-party table, `wshobson/agents`.
pub(super) const PYTHON: Rule = aggregator(
    "skills-python",
    "Python performance optimization",
    "Profiling and optimization patterns for the hot paths, not micro-tweaks.",
    "npx skills add wshobson/agents --skill python-performance-optimization -a claude-code -g -y",
    "wshobson/agents",
    29_714,
    41,
    python,
);

// Command: provenance doc, third-party table, `wshobson/agents`.
pub(super) const RUST: Rule = aggregator(
    "skills-rust",
    "Rust async patterns",
    "Async Rust patterns — the part the compiler will not teach you.",
    "npx skills add wshobson/agents --skill rust-async-patterns -a claude-code -g -y",
    "wshobson/agents",
    16_153,
    42,
    rust,
);

// Command: provenance doc, third-party table, `samber/cc-skills-golang`.
pub(super) const GOLANG: Rule = aggregator(
    "skills-golang",
    "Go code style",
    "A Go style guide the agent applies while writing, rather than at review time.",
    "npx skills add samber/cc-skills-golang --skill golang-code-style -a claude-code -g -y",
    "samber/cc-skills-golang",
    35_764,
    43,
    golang,
);

// Command: provenance doc, third-party table, `github/awesome-copilot`.
pub(super) const JAVA: Rule = aggregator(
    "skills-java",
    "Java Spring Boot patterns",
    "Spring Boot conventions applied as the agent writes controllers and services.",
    "npx skills add github/awesome-copilot --skill java-springboot -a claude-code -g -y",
    "github/awesome-copilot",
    18_370,
    44,
    java,
);

// Command: provenance doc, third-party table, `wshobson/agents`.
pub(super) const NEXTJS: Rule = aggregator(
    "skills-nextjs",
    "Next.js App Router patterns",
    "Server components, layouts, and data fetching done the way the App Router expects.",
    "npx skills add wshobson/agents --skill nextjs-app-router-patterns -a claude-code -g -y",
    "wshobson/agents",
    25_370,
    45,
    nextjs,
);

// Command: provenance doc, third-party table, `analogjs/angular-skills` — an
// Angular-ecosystem org, not the Angular team, so this stays third-party.
pub(super) const ANGULAR: Rule = aggregator(
    "skills-angular",
    "Angular component patterns",
    "Angular component conventions applied while the agent scaffolds.",
    "npx skills add analogjs/angular-skills --skill angular-component -a claude-code -g -y",
    "analogjs/angular-skills",
    9_848,
    46,
    angular,
);

// Command: provenance doc, third-party table, `aj-geddes/useful-ai-prompts`.
pub(super) const EXPRESS: Rule = aggregator(
    "skills-express",
    "Express server patterns",
    "Routing, middleware order, and error handling that hold up past the first route.",
    "npx skills add aj-geddes/useful-ai-prompts --skill nodejs-express-server -a claude-code -g -y",
    "aj-geddes/useful-ai-prompts",
    2_990,
    47,
    express,
);

// Command: provenance doc, third-party table, `affaan-m/everything-claude-code`.
pub(super) const DJANGO: Rule = aggregator(
    "skills-django",
    "Django patterns",
    "Django app, model, and view conventions applied as the agent writes.",
    "npx skills add affaan-m/everything-claude-code --skill django-patterns -a claude-code -g -y",
    "affaan-m/everything-claude-code",
    7_357,
    48,
    django,
);
