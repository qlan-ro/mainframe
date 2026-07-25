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
pub fn build_signals(fp: &ProjectFingerprint) -> Vec<String> {
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
mod tests {
    use super::*;
    use mainframe_types::setup_advisor::GitHost;

    #[test]
    fn empty_fingerprint_yields_no_chips() {
        let fp = ProjectFingerprint::default();
        assert_eq!(build_signals(&fp), Vec::<String>::new());
    }

    /// Chip order is fixed by declaration, not by the order fields were
    /// populated on `fp`: frameworks and tooling are given here in the
    /// reverse of their expected chip order, and the assertion still expects
    /// languages, then frameworks (react before nextjs), then databases,
    /// then tooling (prettier before docker), then dirs, then git host.
    #[test]
    fn builds_the_full_chip_list_in_a_fixed_category_order() {
        let fp = ProjectFingerprint {
            languages: vec!["typescript".to_string()],
            frameworks: vec!["nextjs".to_string(), "react".to_string()],
            databases: vec!["supabase".to_string()],
            tooling: vec!["docker".to_string(), "prettier".to_string()],
            dirs: vec!["tests".to_string()],
            git_host: Some(GitHost::Github),
            ..Default::default()
        };

        assert_eq!(
            build_signals(&fp),
            vec![
                "TypeScript".to_string(),
                "React".to_string(),
                "Next.js".to_string(),
                "Supabase".to_string(),
                "Prettier".to_string(),
                "Docker".to_string(),
                "GitHub remote".to_string(),
                "Tests directory".to_string(),
            ]
        );
    }

    #[test]
    fn git_host_variants_produce_distinct_remote_chips() {
        for (host, expected) in [
            (GitHost::Github, "GitHub remote"),
            (GitHost::Gitlab, "GitLab remote"),
            (GitHost::Other, "Git remote"),
        ] {
            let fp = ProjectFingerprint {
                git_host: Some(host),
                ..Default::default()
            };
            assert_eq!(build_signals(&fp), vec![expected.to_string()]);
        }
    }

    /// Real overlap: `jest.config.*` claims `tooling: ["jest"]`, the `jest`
    /// dependency claims `testing: ["jest"]`. Both map to one "Jest" chip.
    #[test]
    fn jest_detected_via_both_testing_and_tooling_yields_one_chip() {
        let fp = ProjectFingerprint {
            testing: vec!["jest".to_string()],
            tooling: vec!["jest".to_string()],
            ..Default::default()
        };
        assert_eq!(build_signals(&fp), vec!["Jest".to_string()]);
    }

    /// Same overlap as jest above: `pytest.ini` (tooling) and the `pytest`
    /// dependency (testing) both claim "pytest".
    #[test]
    fn pytest_detected_via_both_testing_and_tooling_yields_one_chip() {
        let fp = ProjectFingerprint {
            testing: vec!["pytest".to_string()],
            tooling: vec!["pytest".to_string()],
            ..Default::default()
        };
        assert_eq!(build_signals(&fp), vec!["Pytest".to_string()]);
    }

    #[test]
    fn a_repeated_key_within_one_vector_still_yields_one_chip() {
        let fp = ProjectFingerprint {
            frameworks: vec!["react".to_string(), "react".to_string()],
            ..Default::default()
        };
        assert_eq!(build_signals(&fp), vec!["React".to_string()]);
    }

    /// Guards against a naive implementation that title-cases whatever string
    /// it finds instead of looking it up in an explicit label table.
    #[test]
    fn an_unrecognized_detection_key_produces_no_chip() {
        let fp = ProjectFingerprint {
            languages: vec!["cobol".to_string()],
            ..Default::default()
        };
        assert_eq!(build_signals(&fp), Vec::<String>::new());
    }

    /// Spec AC 2: a near-empty project reads as "thin" to the UI, which
    /// nudges the user whenever fewer than 3 chips come back.
    #[test]
    fn a_near_empty_fingerprint_with_one_weak_detection_yields_fewer_than_three_chips() {
        let fp = ProjectFingerprint {
            languages: vec!["python".to_string()],
            ..Default::default()
        };
        let signals = build_signals(&fp);
        assert_eq!(signals, vec!["Python".to_string()]);
        assert!(signals.len() < 3);
    }
}
