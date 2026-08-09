//! Skill discovery: scans `.claude/skills` and `.claude/commands` (project +
//! global + installed plugins) for SKILL.md / command markdown.

use std::collections::HashMap;
use std::path::Path;

use mainframe_types::skill::{Skill, SkillScope};
use serde_json::Value;
use tokio::fs;

use crate::frontmatter::parse_frontmatter;

use super::{ADAPTER_ID, home_dir, nonempty_attr, read_dir_names, skill_scope_str};

/// Insertion-ordered dedupe map mirroring the TS `Map<string, Skill>`
/// (`set` overwrites in place, iteration preserves first-insert order).
struct SkillMap {
    order: Vec<String>,
    map: HashMap<String, Skill>,
}

impl SkillMap {
    fn new() -> Self {
        Self {
            order: Vec::new(),
            map: HashMap::new(),
        }
    }

    fn has(&self, id: &str) -> bool {
        self.map.contains_key(id)
    }

    fn set(&mut self, id: String, skill: Skill) {
        if !self.map.contains_key(&id) {
            self.order.push(id.clone());
        }
        self.map.insert(id, skill);
    }

    fn into_values(self) -> Vec<Skill> {
        let SkillMap { order, mut map } = self;
        order.into_iter().filter_map(|id| map.remove(&id)).collect()
    }
}

pub async fn list_skills(project_path: &str) -> Vec<Skill> {
    let mut skills = SkillMap::new();
    let home = home_dir();

    scan_skills_dir(
        &Path::new(project_path).join(".claude").join("skills"),
        SkillScope::Project,
        &mut skills,
        None,
    )
    .await;
    scan_commands_dir(
        &Path::new(project_path).join(".claude").join("commands"),
        SkillScope::Project,
        &mut skills,
    )
    .await;
    scan_skills_dir(
        &home.join(".claude").join("skills"),
        SkillScope::Global,
        &mut skills,
        None,
    )
    .await;
    scan_commands_dir(
        &home.join(".claude").join("commands"),
        SkillScope::Global,
        &mut skills,
    )
    .await;

    let plugins_path = home
        .join(".claude")
        .join("plugins")
        .join("installed_plugins.json");
    if let Ok(plugins_raw) = fs::read_to_string(&plugins_path).await
        && let Ok(plugins_file) = serde_json::from_str::<Value>(&plugins_raw)
        && let Some(plugins_map) = plugins_file.get("plugins").and_then(Value::as_object)
    {
        for (key, installations) in plugins_map {
            let plugin_name = key.split('@').next().unwrap_or(key).to_string();
            if let Some(installs) = installations.as_array() {
                for install in installs {
                    if let Some(install_path) = install.get("installPath").and_then(Value::as_str) {
                        let plugin_skills_dir = Path::new(install_path).join("skills");
                        scan_skills_dir(
                            &plugin_skills_dir,
                            SkillScope::Plugin,
                            &mut skills,
                            Some(&plugin_name),
                        )
                        .await;
                    }
                }
            }
        }
    }
    // No plugins file or parse error → the `if let` chain falls through.

    skills.into_values()
}

async fn scan_skills_dir(
    dir: &Path,
    scope: SkillScope,
    skills: &mut SkillMap,
    plugin_name: Option<&str>,
) {
    let entries = match read_dir_names(dir).await {
        Some(e) => e,
        None => return,
    };

    for entry in entries {
        let skill_md_path = dir.join(&entry).join("SKILL.md");
        let resolved_path = match fs::canonicalize(&skill_md_path).await {
            Ok(p) => p,
            Err(_) => continue, /* expected: missing SKILL.md or unresolvable symlink */
        };
        let raw = match fs::read_to_string(&resolved_path).await {
            Ok(r) => r,
            Err(_) => continue,
        };
        let attributes = parse_frontmatter(&raw).attributes;

        let name = entry.clone();
        let invocation_name = match plugin_name {
            Some(p) => format!("{p}:{name}"),
            None => name.clone(),
        };
        let id = format!(
            "{ADAPTER_ID}:{}:{}{name}",
            skill_scope_str(scope),
            plugin_name.map(|p| format!("{p}:")).unwrap_or_default(),
        );

        if scope == SkillScope::Global && skills.has(&format!("{ADAPTER_ID}:project:{name}")) {
            continue;
        }

        let resolved_path_str = resolved_path.to_string_lossy().into_owned();
        skills.set(
            id.clone(),
            Skill {
                id,
                adapter_id: ADAPTER_ID.to_string(),
                name: name.clone(),
                display_name: nonempty_attr(&attributes, "name").unwrap_or(name),
                description: attributes.get("description").cloned().unwrap_or_default(),
                scope,
                plugin_name: plugin_name.map(str::to_string),
                file_path: resolved_path_str,
                content: raw,
                invocation_name: Some(invocation_name),
            },
        );
    }
}

async fn scan_commands_dir(dir: &Path, scope: SkillScope, skills: &mut SkillMap) {
    let groups = match read_dir_names(dir).await {
        Some(g) => g,
        None => return,
    };

    for group in groups {
        let group_dir = dir.join(&group);
        let entries = match read_dir_names(&group_dir).await {
            Some(e) => e,
            None => continue,
        };

        for entry in entries {
            if !entry.ends_with(".md") {
                continue;
            }
            let file_path = group_dir.join(&entry);
            let raw = match fs::read_to_string(&file_path).await {
                Ok(r) => r,
                Err(_) => continue, /* expected: unreadable file */
            };
            let attributes = parse_frontmatter(&raw).attributes;

            let command_name = entry.strip_suffix(".md").unwrap_or(&entry);
            let invocation_name = format!("{group}:{command_name}");
            let name = invocation_name.clone();
            let id = format!("{ADAPTER_ID}:{}:{name}", skill_scope_str(scope));

            if scope == SkillScope::Global && skills.has(&format!("{ADAPTER_ID}:project:{name}")) {
                continue;
            }

            let file_path_str = file_path.to_string_lossy().into_owned();
            skills.set(
                id.clone(),
                Skill {
                    id,
                    adapter_id: ADAPTER_ID.to_string(),
                    name,
                    display_name: nonempty_attr(&attributes, "name")
                        .unwrap_or_else(|| invocation_name.clone()),
                    description: attributes.get("description").cloned().unwrap_or_default(),
                    scope,
                    plugin_name: None,
                    file_path: file_path_str,
                    content: raw,
                    invocation_name: Some(invocation_name),
                },
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn lists_project_skills_with_frontmatter() {
        let tmp = tempdir().unwrap();
        let skill_dir = tmp.path().join(".claude").join("skills").join("pdf");
        fs::create_dir_all(&skill_dir).await.unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: PDF Tools\ndescription: Work with PDFs\n---\n\n# Body",
        )
        .await
        .unwrap();

        let skills = list_skills(tmp.path().to_str().unwrap()).await;
        let pdf = skills.iter().find(|s| s.name == "pdf").expect("pdf skill");
        assert_eq!(pdf.display_name, "PDF Tools");
        assert_eq!(pdf.description, "Work with PDFs");
        assert_eq!(pdf.scope, SkillScope::Project);
        assert_eq!(pdf.invocation_name.as_deref(), Some("pdf"));
        assert_eq!(pdf.id, "claude:project:pdf");
    }
}
