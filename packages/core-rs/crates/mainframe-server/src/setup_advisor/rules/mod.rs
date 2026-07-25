//! The rules dataset, one module per recommendation category.

pub mod hooks;
pub mod mcp;
pub mod plugins;
pub mod skills;
pub mod subagents;

use super::rule::Rule;

/// Every shipped rule, in canonical category order.
///
/// Returns borrowed references rather than one `&'static [Rule]`: five static
/// slices cannot be concatenated into a single `'static` slice without a
/// `LazyLock` or a leak, and one small allocation is nothing beside the
/// filesystem walk that precedes it.
pub fn all() -> Vec<&'static Rule> {
    mcp::RULES
        .iter()
        .chain(skills::RULES.iter())
        .chain(hooks::RULES.iter())
        .chain(subagents::RULES.iter())
        .chain(plugins::RULES.iter())
        .collect()
}
