use super::*;

fn model(id: &str, owner: &str) -> ProxyModel {
    ProxyModel {
        id: id.to_string(),
        owned_by: Some(owner.to_string()),
    }
}

/// The catalog a real install serves, in the order the proxy actually returned it, so
/// this pins the whole picker section rather than a pair of ids.
#[test]
fn a_real_catalog_sorts_by_provider_then_capability() {
    let catalog = vec![
        model("gpt-5.4-mini", "openai"),
        model("gpt-5.6-terra", "openai"),
        model("codex-auto-review", "openai"),
        model("kimi-k2.7-code-highspeed", "moonshot"),
        model("gpt-5.3-codex-spark", "openai"),
        model("gpt-5.5", "openai"),
        model("gpt-5.6-sol", "openai"),
        model("kimi-k2.6", "moonshot"),
        model("gpt-5.4", "openai"),
        model("kimi-k2", "moonshot"),
        model("kimi-k2-thinking", "moonshot"),
        model("kimi-k2.5", "moonshot"),
        model("kimi-k2.7-code", "moonshot"),
        model("kimi-k3", "moonshot"),
        model("gpt-5.6-luna", "openai"),
    ];

    let ordered: Vec<&str> = by_capability(&catalog)
        .iter()
        .map(|m| m.id.as_str())
        .collect();

    assert_eq!(
        ordered,
        vec![
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
            "gpt-5.5",
            "gpt-5.4",
            "gpt-5.4-mini",
            "gpt-5.3-codex-spark",
            "codex-auto-review",
            "kimi-k3",
            "kimi-k2.7-code",
            "kimi-k2.7-code-highspeed",
            "kimi-k2.6",
            "kimi-k2.5",
            "kimi-k2-thinking",
            "kimi-k2",
        ]
    );
}

/// Providers we've never ranked must not displace the ones we have.
#[test]
fn an_unranked_provider_follows_the_ranked_ones() {
    let catalog = vec![
        model("qwen-4", "alibaba"),
        model("kimi-k3", "moonshot"),
        model("glm-5", "z.ai"),
        model("gpt-5.5", "openai"),
    ];
    let ordered: Vec<&str> = by_capability(&catalog)
        .iter()
        .map(|m| m.id.as_str())
        .collect();
    assert_eq!(ordered, vec!["gpt-5.5", "kimi-k3", "qwen-4", "glm-5"]);
}

#[test]
fn a_tier_is_read_off_the_name_the_vendor_chose() {
    assert_eq!(tier("gpt-5.6-sol"), Tier::Plain);
    assert_eq!(tier("gpt-5.4-mini"), Tier::Fast);
    assert_eq!(tier("kimi-k2.7-code"), Tier::Code);
    assert_eq!(tier("kimi-k2-thinking"), Tier::Thinking);
    // Both markers present: the cheap cut is the weaker claim, so it wins.
    assert_eq!(tier("kimi-k2.7-code-highspeed"), Tier::Fast);
    // A marker must be its own segment — `codex` is not `code` inside another word.
    assert_eq!(tier("gpt-5.6-nanotech"), Tier::Plain);
}

/// Versions are compared as numbers, not strings: `k2.10` outranks `k2.9`.
#[test]
fn versions_compare_numerically_not_lexically() {
    let catalog = vec![
        model("kimi-k2.9", "moonshot"),
        model("kimi-k2.10", "moonshot"),
    ];
    let ordered: Vec<&str> = by_capability(&catalog)
        .iter()
        .map(|m| m.id.as_str())
        .collect();
    assert_eq!(ordered, vec!["kimi-k2.10", "kimi-k2.9"]);
}
