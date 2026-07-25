//! The rules dataset, one module per recommendation category.

pub mod families;
pub mod hooks;
pub mod mcp;
pub mod plugins;
pub mod skills;
pub mod subagents;

#[cfg(test)]
mod tests;

use mainframe_types::setup_advisor::ProjectFingerprint;

use super::fingerprint::FILE_COUNT_CAP;
use super::rule::Rule;

/// Projects past this size stop fitting in one reviewer's head.
const LARGE_PROJECT_FILES: u64 = 500;

/// Evidence for the rules gated on project size. The walk stops at
/// `FILE_COUNT_CAP`, so a saturated count reads as "5000+" rather than claiming
/// a total nobody counted.
fn large_project_evidence(fp: &ProjectFingerprint) -> Option<String> {
    if fp.file_count <= LARGE_PROJECT_FILES {
        return None;
    }
    let more = if fp.file_count >= FILE_COUNT_CAP as u64 {
        "+"
    } else {
        ""
    };
    Some(format!("{}{more} files in the project", fp.file_count))
}

/// Every shipped rule, in canonical category order.
///
/// Returns borrowed references rather than one `&'static [Rule]`: five static
/// slices cannot be concatenated into a single `'static` slice without a
/// `LazyLock` or a leak, and one small allocation is nothing beside the
/// filesystem walk that precedes it.
pub fn all() -> Vec<&'static Rule> {
    mcp::RULES
        .iter()
        .chain(skills::rules())
        .chain(hooks::RULES.iter())
        .chain(subagents::RULES.iter())
        .chain(plugins::RULES.iter())
        .collect()
}
