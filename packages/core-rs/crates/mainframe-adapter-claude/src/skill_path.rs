//! Resolves a skill name to its `SKILL.md` by probing the locations the Claude
//! CLI supports (project → user → plugin). Kept **synchronous** (std::fs) and
//! logger-free. Probes are bounded + cached, and callers (history) invoke it
//! inside their async loop. A spawn_blocking wrap is a possible later change;
//! the sync form keeps the `cache: &mut HashMap` signature.

use std::collections::HashMap;
use std::path::PathBuf;

use dirs::home_dir;

// Claude CLI only accepts slash-command names matching /^[a-zA-Z0-9:_-]+$/;
// mirror /^[a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)?$/ so any skillName fed into a
// path cannot contain "..", "/", or other path-traversal metachars.
fn is_valid_skill_name(name: &str) -> bool {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.is_empty() || parts.len() > 2 {
        return false;
    }
    parts
        .iter()
        .all(|p| mainframe_types::ids::is_safe_identifier(p))
}

fn home() -> PathBuf {
    home_dir().unwrap_or_default()
}

fn path_str(p: PathBuf) -> String {
    p.to_string_lossy().to_string()
}

fn is_dir_entry(entry: &std::fs::DirEntry) -> bool {
    entry.file_type().map(|t| t.is_dir()).unwrap_or(false)
}

/// Like `resolveSkillPath` but returns `None` when no SKILL.md is found on disk.
pub(crate) fn resolve_existing_skill_path(
    project_path: Option<&str>,
    skill_name: &str,
) -> Option<String> {
    if !is_valid_skill_name(skill_name) {
        return None;
    }
    let colon_idx = skill_name.find(':');
    let plugin_prefix: Option<&str> = colon_idx.map(|i| &skill_name[..i]);
    let leaf_name: &str = colon_idx
        .map(|i| &skill_name[i + 1..])
        .unwrap_or(skill_name);

    let mut candidates: Vec<PathBuf> = Vec::new();

    // Plain (unqualified) skills: project → user home → every plugin dir.
    if plugin_prefix.is_none() {
        if let Some(pp) = project_path {
            candidates.push(
                PathBuf::from(pp)
                    .join(".claude")
                    .join("skills")
                    .join(leaf_name)
                    .join("SKILL.md"),
            );
        }
        candidates.push(
            home()
                .join(".claude")
                .join("skills")
                .join(leaf_name)
                .join("SKILL.md"),
        );

        let plugins_dir = home().join(".claude").join("plugins");
        if let Ok(entries) = std::fs::read_dir(&plugins_dir) {
            for entry in entries.flatten() {
                if is_dir_entry(&entry) {
                    candidates.push(
                        plugins_dir
                            .join(entry.file_name())
                            .join("skills")
                            .join(leaf_name)
                            .join("SKILL.md"),
                    );
                }
            }
        }
    }

    // Plugin cache layout:
    // ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<name>/SKILL.md
    let cache_dir = home().join(".claude").join("plugins").join("cache");
    if let Ok(marketplaces) = std::fs::read_dir(&cache_dir) {
        for marketplace in marketplaces.flatten() {
            if !is_dir_entry(&marketplace) {
                continue;
            }
            let market_dir = cache_dir.join(marketplace.file_name());
            if let Ok(plugins) = std::fs::read_dir(&market_dir) {
                for plugin in plugins.flatten() {
                    if !is_dir_entry(&plugin) {
                        continue;
                    }
                    if let Some(pp) = plugin_prefix
                        && plugin.file_name().to_string_lossy() != pp
                    {
                        continue;
                    }
                    let plugin_dir = market_dir.join(plugin.file_name());
                    if let Ok(versions) = std::fs::read_dir(&plugin_dir) {
                        for version in versions.flatten() {
                            if !is_dir_entry(&version) {
                                continue;
                            }
                            candidates.push(
                                plugin_dir
                                    .join(version.file_name())
                                    .join("skills")
                                    .join(leaf_name)
                                    .join("SKILL.md"),
                            );
                        }
                    }
                }
            }
        }
    }

    // Non-cache plugin dirs for plugin-qualified skills.
    if let Some(pp) = plugin_prefix {
        let plugins_dir = home().join(".claude").join("plugins");
        if let Ok(entries) = std::fs::read_dir(&plugins_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !is_dir_entry(&entry) || name == "cache" {
                    continue;
                }
                if name == pp || name == format!("{pp}-plugin") {
                    candidates.push(
                        plugins_dir
                            .join(entry.file_name())
                            .join("skills")
                            .join(leaf_name)
                            .join("SKILL.md"),
                    );
                }
            }
        }
    }

    for candidate in candidates {
        if std::fs::metadata(&candidate).is_ok() {
            return Some(path_str(candidate));
        }
    }
    None
}

/// Read SKILL.md content synchronously, stripping a leading YAML frontmatter
/// block. Returns `None` if unreadable.
pub(crate) fn read_skill_content(skill_path: &str) -> Option<String> {
    let raw = std::fs::read_to_string(skill_path).ok()?;
    Some(strip_leading_frontmatter(&raw))
}

/// `raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()`.
fn strip_leading_frontmatter(raw: &str) -> String {
    if !raw.starts_with("---") {
        return raw.trim().to_string();
    }
    let after_open = &raw[3..];
    let body_start = if after_open.starts_with("\r\n") {
        5
    } else if after_open.starts_with('\n') {
        4
    } else {
        return raw.trim().to_string();
    };

    let rest = &raw.as_bytes()[body_start..];
    let mut i = 0;
    while i < rest.len() {
        // try to match \r?\n---
        let mut j = i;
        if rest[j] == b'\r' {
            j += 1;
        }
        if j < rest.len() && rest[j] == b'\n' && raw[body_start + j + 1..].starts_with("---") {
            // consume \r?\n? after ---
            let mut k = j + 1 + 3;
            if k < rest.len() && rest[k] == b'\r' {
                k += 1;
            }
            if k < rest.len() && rest[k] == b'\n' {
                k += 1;
            }
            return raw[body_start + k..].trim().to_string();
        }
        i += 1;
    }
    raw.trim().to_string()
}

/// Resolve a skill name to its SKILL.md, probing project → user → plugin, with a
/// per-session cache so this is one probe per unique skill.
pub(crate) fn resolve_skill_path(
    project_path: Option<&str>,
    skill_name: &str,
    cache: Option<&mut HashMap<String, String>>,
) -> String {
    if let Some(c) = cache.as_deref()
        && let Some(cached) = c.get(skill_name)
    {
        return cached.clone();
    }

    if let Some(existing) = resolve_existing_skill_path(project_path, skill_name) {
        if let Some(c) = cache {
            c.insert(skill_name.to_string(), existing.clone());
        }
        return existing;
    }

    if !is_valid_skill_name(skill_name) {
        return String::new();
    }
    let colon_idx = skill_name.find(':');
    let leaf_name = colon_idx
        .map(|i| &skill_name[i + 1..])
        .unwrap_or(skill_name);
    let fallback = path_str(
        home()
            .join(".claude")
            .join("skills")
            .join(leaf_name)
            .join("SKILL.md"),
    );
    if let Some(c) = cache {
        c.insert(skill_name.to_string(), fallback.clone());
    }
    fallback
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_skill_names() {
        assert!(is_valid_skill_name("pdf"));
        assert!(is_valid_skill_name("work-logger:slack_writer"));
        assert!(!is_valid_skill_name("a:b:c"));
        assert!(!is_valid_skill_name("../etc"));
        assert!(!is_valid_skill_name("has/slash"));
        assert!(!is_valid_skill_name(""));
        assert!(!is_valid_skill_name("a:"));
    }

    #[test]
    fn strips_leading_frontmatter() {
        let raw = "---\nname: PDF\ndescription: d\n---\n# Body\ntext";
        assert_eq!(strip_leading_frontmatter(raw), "# Body\ntext");
    }

    #[test]
    fn strips_crlf_frontmatter() {
        let raw = "---\r\nname: X\r\n---\r\nbody";
        assert_eq!(strip_leading_frontmatter(raw), "body");
    }

    #[test]
    fn no_frontmatter_returns_trimmed() {
        assert_eq!(strip_leading_frontmatter("  plain text  "), "plain text");
    }

    #[test]
    fn resolve_existing_rejects_invalid_names() {
        assert_eq!(resolve_existing_skill_path(None, "bad/name"), None);
    }

    #[test]
    fn resolve_falls_back_to_conventional_path_and_caches() {
        let mut cache: HashMap<String, String> = HashMap::new();
        // A name that won't exist on disk resolves to the conventional fallback.
        let out = resolve_skill_path(
            Some("/nonexistent-project"),
            "definitely-not-a-real-skill-xyz",
            Some(&mut cache),
        );
        assert!(out.ends_with(".claude/skills/definitely-not-a-real-skill-xyz/SKILL.md"));
        assert_eq!(cache.get("definitely-not-a-real-skill-xyz"), Some(&out));
    }
}
