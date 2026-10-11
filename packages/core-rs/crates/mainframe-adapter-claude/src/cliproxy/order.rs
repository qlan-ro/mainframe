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
pub(crate) fn by_capability(catalog: &[ProxyModel]) -> Vec<&ProxyModel> {
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
#[path = "order_tests.rs"]
mod tests;
