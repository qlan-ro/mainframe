use super::*;

/// The catalog a real install serves, so the expectations are the strings that actually
/// reach the picker rather than invented ids.
#[test]
fn a_label_names_the_provider_then_the_model() {
    for (id, owner, expected) in [
        ("kimi-k3", "moonshot", "Moonshot - Kimi K3"),
        ("gpt-5.6-sol", "openai", "OpenAI - GPT 5.6 Sol"),
        ("gpt-5.4-mini", "openai", "OpenAI - GPT 5.4 Mini"),
        (
            "gpt-5.3-codex-spark",
            "openai",
            "OpenAI - GPT 5.3 Codex Spark",
        ),
        (
            "kimi-k2.7-code-highspeed",
            "moonshot",
            "Moonshot - Kimi K2.7 Code Highspeed",
        ),
        ("codex-auto-review", "openai", "OpenAI - Codex Auto Review"),
    ] {
        assert_eq!(display_label(id, Some(owner)), expected, "{id}");
    }
}

/// Vendors spell their own names; a title-case pass would print `Openai`.
#[test]
fn a_known_provider_keeps_its_own_spelling() {
    assert_eq!(display_label("gpt-5.5", Some("OPENAI")), "OpenAI - GPT 5.5");
    assert_eq!(display_label("glm-4.6", Some("z.ai")), "Z.ai - GLM 4.6");
    assert_eq!(display_label("grok-5", Some("xai")), "xAI - Grok 5");
    // An owner we've never seen still reads as a name.
    assert_eq!(
        display_label("mistral-3", Some("mistral")),
        "Mistral - Mistral 3"
    );
}

/// The proxy may report no owner, or a blank one; neither leaves a dangling separator.
#[test]
fn a_missing_provider_leaves_the_model_standing_alone() {
    assert_eq!(display_label("kimi-k3", None), "Kimi K3");
    assert_eq!(display_label("kimi-k3", Some("   ")), "Kimi K3");
}

/// A degenerate id must fall back to itself, never to an empty picker row.
#[test]
fn an_id_with_nothing_to_format_falls_back_to_itself() {
    assert_eq!(display_label("", None), "");
    assert_eq!(display_label("---", None), "---");
    assert_eq!(display_label("-kimi-", None), "Kimi");
}

#[test]
fn a_description_names_the_variant_and_the_account_that_pays() {
    for (id, owner, expected) in [
        (
            "gpt-5.6-sol",
            "openai",
            "GPT 5.6 Sol · Runs on your OpenAI account",
        ),
        (
            "gpt-5.4-mini",
            "openai",
            "GPT 5.4 Mini · Faster and lighter, on your OpenAI account",
        ),
        (
            "kimi-k2.7-code",
            "moonshot",
            "Kimi K2.7 Code · Tuned for coding, on your Moonshot account",
        ),
        (
            "kimi-k2-thinking",
            "moonshot",
            "Kimi K2 Thinking · Extended reasoning, on your Moonshot account",
        ),
    ] {
        assert_eq!(display_description(id, Some(owner)), expected, "{id}");
    }
}

/// With no owner the caption still has to say where the model came from.
#[test]
fn a_description_without_an_owner_names_the_proxy_instead() {
    assert_eq!(
        display_description("kimi-k3", None),
        "Kimi K3 · Runs through your local CLIProxyAPI"
    );
    assert_eq!(
        display_description("kimi-k2.7-code-highspeed", None),
        "Kimi K2.7 Code Highspeed · Faster and lighter, through your local CLIProxyAPI"
    );
}
