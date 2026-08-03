//! Parses the `skills` CLI's `list --json` output into [`SkillsCliEntry`]s
//! and merges project+global manifests. No dedup across scopes: the same
//! skill name can be installed at both project and global scope, and the UI
//! needs to show both rows.

use super::{Scope, SkillsCliEntry};

#[derive(serde::Deserialize)]
struct RawEntry {
    name: Option<String>,
    source: Option<String>,
    #[serde(rename = "sourceType")]
    source_type: Option<String>,
    #[serde(rename = "skillPath")]
    skill_path: Option<String>,
}

/// Accepts both shapes the CLI has been observed to emit: a lockfile-style
/// object keyed by skill name, or a flat array of entries carrying their own
/// `name` field.
pub fn parse_entries(raw: &str, scope: Scope) -> Vec<SkillsCliEntry> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        tracing::warn!(?scope, "skills CLI manifest output was not valid JSON");
        return Vec::new();
    };
    match value {
        serde_json::Value::Array(items) => items
            .into_iter()
            .filter_map(|item| entry_from(item, None, scope))
            .collect(),
        serde_json::Value::Object(map) => map
            .into_iter()
            .filter_map(|(key, item)| entry_from(item, Some(key), scope))
            .collect(),
        _ => Vec::new(),
    }
}

fn entry_from(
    item: serde_json::Value,
    key: Option<String>,
    scope: Scope,
) -> Option<SkillsCliEntry> {
    let raw: RawEntry = serde_json::from_value(item).ok()?;
    let name = raw.name.or(key).filter(|n| !n.is_empty())?;
    Some(SkillsCliEntry {
        name,
        scope,
        source: raw.source,
        source_type: raw.source_type,
        skill_path: raw.skill_path,
    })
}

pub fn merge(project: Vec<SkillsCliEntry>, global: Vec<SkillsCliEntry>) -> Vec<SkillsCliEntry> {
    let mut merged = project;
    merged.extend(global);
    merged
}
