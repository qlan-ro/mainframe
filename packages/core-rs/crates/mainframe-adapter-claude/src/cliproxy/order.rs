//! Capability order for the proxy catalog. The proxy returns models in whatever order its
//! providers hand them over — a real install opens the picker on `GPT 5.4 Mini` — and it
//! publishes no ranking to sort by. So the order is read off the ids: provider, then version,
//! then the cut of the model the vendor named it after. Ids that say nothing sort last rather
//! than anywhere in the middle.

use std::cmp::Reverse;

use super::ProxyModel;

/// Providers in the order their runs should read. Anything else follows, alphabetically.
const PROVIDER_ORDER: &[&str] = &["openai", "moonshot"];

/// Codenames carry no version to sort on. The GPT-5.6 three descend the way they read —
/// sun, earth, moon — which is the only signal the names give; unlisted ones go alphabetical.
const CODENAME_ORDER: &[&str] = &["sol", "terra", "luna"];

const FAST_MARKERS: &[&str] = &[
    "mini",
    "spark",
    "highspeed",
    "air",
    "lite",
    "flash",
    "nano",
    "turbo",
    "fast",
];
const CODE_MARKERS: &[&str] = &["code", "codex", "coder"];
const THINKING_MARKERS: &[&str] = &["thinking", "reasoning"];

/// The cut of a model its id advertises, most capable first — the derive order is the point.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Tier {
    Thinking,
    Plain,
    Code,
    Fast,
}

pub fn tier(id: &str) -> Tier {
    let has = |markers: &[&str]| {
        id.split('-')
            .any(|segment| markers.contains(&segment.to_ascii_lowercase().as_str()))
    };
    // Fast wins over code: `kimi-k2.7-code-highspeed` is the cheap cut of `kimi-k2.7-code`.
    if has(FAST_MARKERS) {
        Tier::Fast
    } else if has(CODE_MARKERS) {
        Tier::Code
    } else if has(THINKING_MARKERS) {
        Tier::Thinking
    } else {
        Tier::Plain
    }
}

/// The catalog, strongest first. Borrows rather than clones — the caller is building
/// [`AdapterModel`](mainframe_types::adapter::AdapterModel)s from these anyway.
pub fn by_capability(catalog: &[ProxyModel]) -> Vec<&ProxyModel> {
    let mut ordered: Vec<&ProxyModel> = catalog.iter().collect();
    ordered.sort_by_key(|model| sort_key(model));
    ordered
}

/// The version an id names, as its numeric components so `k2.10` outranks `k2.9` — a float
/// parse would read those as 2.1 and 2.9. Reversed, so the higher version sorts first; empty
/// for an id that names no version, which puts it last.
fn version_key(id: &str) -> Reverse<Vec<u32>> {
    let components = id
        .split('-')
        .find_map(|segment| {
            let digits: String = segment
                .trim_start_matches(|c: char| !c.is_ascii_digit())
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            let components: Vec<u32> = digits
                .split('.')
                .filter_map(|part| part.parse().ok())
                .collect();
            (!components.is_empty()).then_some(components)
        })
        .unwrap_or_default();
    Reverse(components)
}

fn codename_key(id: &str) -> usize {
    id.split('-')
        .filter_map(|segment| {
            CODENAME_ORDER
                .iter()
                .position(|name| *name == segment.to_ascii_lowercase())
        })
        .next()
        .unwrap_or(CODENAME_ORDER.len())
}

/// Provider group first so each vendor's models stay together, then capability within it.
/// The trailing id keeps the order stable for models the heuristics can't separate.
fn sort_key(model: &ProxyModel) -> (usize, String, Reverse<Vec<u32>>, Tier, usize, String) {
    let id = model.id.to_ascii_lowercase();
    let owner = model
        .owned_by
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    (
        PROVIDER_ORDER
            .iter()
            .position(|name| *name == owner)
            .unwrap_or(PROVIDER_ORDER.len()),
        owner,
        version_key(&id),
        tier(&id),
        codename_key(&id),
        id,
    )
}

#[cfg(test)]
mod tests {
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
}
