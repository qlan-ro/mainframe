//! The scaffold skills: what the pasted SKILL.md is allowed to say.

use mainframe_types::setup_advisor::RecommendationCategory;

use super::super::all;

/// Every scaffold rule ships one file — the SKILL.md at its `target_path`.
fn scaffold_bodies() -> Vec<(&'static str, &'static str)> {
    let bodies: Vec<(&str, &str)> = all()
        .into_iter()
        .filter(|rule| {
            rule.category == RecommendationCategory::Skills && rule.target_path.is_some()
        })
        .map(|rule| (rule.id, rule.command))
        .collect();
    assert_eq!(bodies.len(), 8, "the scaffold family lost or gained a rule");
    bodies
}

/// The card creates one file. A body that links to `examples/unit-test.ts` or
/// runs `scripts/validate-migration.sh` sends the user after a file that has
/// never existed anywhere.
#[test]
fn no_scaffold_body_points_at_a_companion_file_it_never_creates() {
    for (id, body) in scaffold_bodies() {
        assert!(
            !body.contains("]("),
            "{id} links to a file the command does not write"
        );
        assert!(
            !body.contains("scripts/"),
            "{id} runs a script the command does not write"
        );
    }
}

fn conventions_body() -> &'static str {
    scaffold_bodies()
        .into_iter()
        .find(|(id, _)| *id == "skills-project-conventions")
        .expect("skills-project-conventions")
        .1
}

/// This is the one body the agent loads unprompted, and the recommender knows
/// nothing about the project's conventions — so it may ship placeholders, never
/// invented house rules the agent would then enforce as fact.
#[test]
fn the_conventions_scaffold_asserts_no_convention_of_its_own() {
    let body = conventions_body();

    for fabricated in [
        "PascalCase",
        "camelCase",
        "UPPER_SNAKE_CASE",
        "{ data, error, meta }",
        "Result<T, E>",
        "console.log",
    ] {
        assert!(
            !body.contains(fabricated),
            "the conventions scaffold still asserts {fabricated:?} about a project it has not read"
        );
    }
}

#[test]
fn the_conventions_scaffold_says_it_is_a_template() {
    assert!(
        conventions_body().contains("TEMPLATE"),
        "an unfilled body has to announce itself before the agent applies it"
    );
}

/// `user-invocable: false` is what makes this background knowledge rather than a
/// slash command. Adding `disable-model-invocation: true` on top would close the
/// only door left and ship a file nothing can ever load.
#[test]
fn the_conventions_scaffold_stays_reachable_by_the_model() {
    let body = conventions_body();

    assert!(body.contains("user-invocable: false"));
    assert!(!body.contains("disable-model-invocation"));
}
