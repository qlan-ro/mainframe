//! Human-readable evidence chips derived from a filled fingerprint.

use mainframe_types::setup_advisor::{GitHost, ProjectFingerprint};

use super::detections::{Field, has, push_unique, values};

/// Detection key to chip label, in output order. A key absent from this table
/// renders no chip: labels are chosen, never title-cased off a raw key.
const CHIPS: &[(Field, &str, &str)] = &[
    (Field::Language, "typescript", "TypeScript"),
    (Field::Language, "python", "Python"),
    (Field::Language, "rust", "Rust"),
    (Field::Language, "go", "Go"),
    (Field::Language, "java", "Java"),
    (Field::Framework, "react", "React"),
    (Field::Framework, "nextjs", "Next.js"),
    (Field::Framework, "vue", "Vue"),
    (Field::Framework, "angular", "Angular"),
    (Field::Framework, "svelte", "Svelte"),
    (Field::Framework, "express", "Express"),
    (Field::Framework, "fastapi", "FastAPI"),
    (Field::Framework, "django", "Django"),
    (Field::Database, "prisma", "Prisma"),
    (Field::Database, "drizzle", "Drizzle"),
    (Field::Database, "convex", "Convex"),
    (Field::Database, "postgres", "Postgres"),
    (Field::Database, "supabase", "Supabase"),
    (Field::ExternalApi, "stripe", "Stripe"),
    (Field::ExternalApi, "openai", "OpenAI"),
    (Field::ExternalApi, "anthropic", "Anthropic"),
    (Field::ExternalApi, "langchain", "LangChain"),
    (Field::ExternalApi, "clerk", "Clerk"),
    (Field::ExternalApi, "auth0", "Auth0"),
    (Field::ExternalApi, "next-auth", "NextAuth"),
    (Field::ExternalApi, "passport", "Passport"),
    (Field::ExternalApi, "aws", "AWS"),
    (Field::ExternalApi, "sentry", "Sentry"),
    (Field::Testing, "vitest", "Vitest"),
    (Field::Testing, "jest", "Jest"),
    (Field::Testing, "playwright", "Playwright"),
    (Field::Testing, "pytest", "Pytest"),
    (Field::Tooling, "prettier", "Prettier"),
    (Field::Tooling, "eslint", "ESLint"),
    // `tsconfig.json` and a `typescript` dependency are one fact to the reader.
    (Field::Tooling, "tsconfig", "TypeScript"),
    (Field::Tooling, "tailwind", "Tailwind"),
    (Field::Tooling, "jest", "Jest"),
    (Field::Tooling, "pytest", "Pytest"),
    (Field::Tooling, "ruff", "Ruff"),
    (Field::Tooling, "docker", "Docker"),
];

/// Root directories worth showing. `src`/`app`/`components` are omitted: every
/// project has them, so they tell the reader nothing.
const DIR_CHIPS: &[(&str, &str)] = &[("tests", "Tests directory"), ("api", "API directory")];

/// Renders `fp`'s detections as display chips, deduplicated, in a fixed order.
pub(crate) fn build_signals(fp: &ProjectFingerprint) -> Vec<String> {
    let mut chips = Vec::new();
    for &(field, key, label) in CHIPS {
        if has(values(fp, field), key) {
            push_unique(&mut chips, label);
        }
    }
    if let Some(host) = fp.git_host {
        push_unique(
            &mut chips,
            match host {
                GitHost::Github => "GitHub remote",
                GitHost::Gitlab => "GitLab remote",
                GitHost::Other => "Git remote",
            },
        );
    }
    for &(key, label) in DIR_CHIPS {
        if has(&fp.dirs, key) {
            push_unique(&mut chips, label);
        }
    }
    chips
}

#[cfg(test)]
#[path = "signals_tests.rs"]
mod tests;
