//! Ported from `packages/core/src/plugins/builtin/claude/skills.ts`.
//!
//! Scans `.claude/{skills,commands,agents}` (project + global + installed
//! plugins) for SKILL.md / command / agent markdown, and the CRUD helpers that
//! create/update/delete them. Frontmatter is read/written via `crate::frontmatter`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use mainframe_types::skill::{
    AgentConfig, AgentScope, CreateAgentInput, CreateSkillInput, Skill, SkillScope,
};
use serde_json::Value;
use tokio::fs;

use crate::frontmatter::{build_frontmatter, parse_frontmatter};

const ADAPTER_ID: &str = "claude";

#[derive(Debug, thiserror::Error)]
pub enum SkillsError {
    #[error("Skill not found: {0}")]
    SkillNotFound(String),
    #[error("Agent not found: {0}")]
    AgentNotFound(String),
    #[error("Cannot delete plugin skills")]
    CannotDeletePluginSkills,
    #[error("{0}")]
    Io(String),
}

impl From<std::io::Error> for SkillsError {
    fn from(e: std::io::Error) -> Self {
        SkillsError::Io(e.to_string())
    }
}

fn skill_scope_str(scope: SkillScope) -> &'static str {
    match scope {
        SkillScope::Project => "project",
        SkillScope::Global => "global",
        SkillScope::Plugin => "plugin",
    }
}

fn agent_scope_str(scope: AgentScope) -> &'static str {
    match scope {
        AgentScope::Project => "project",
        AgentScope::Global => "global",
    }
}

fn agent_to_skill_scope(scope: AgentScope) -> SkillScope {
    match scope {
        AgentScope::Project => SkillScope::Project,
        AgentScope::Global => SkillScope::Global,
    }
}

fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_default()
}

/// `readdir(dir)` returning just the entry names — `None` on any error (the TS
/// `try { … } catch { return }`).
async fn read_dir_names(dir: &Path) -> Option<Vec<String>> {
    let mut rd = match fs::read_dir(dir).await {
        Ok(rd) => rd,
        Err(_) => return None, /* expected: directory absent */
    };
    let mut names = Vec::new();
    loop {
        match rd.next_entry().await {
            Ok(Some(entry)) => names.push(entry.file_name().to_string_lossy().into_owned()),
            Ok(None) => break,
            Err(_) => return None,
        }
    }
    Some(names)
}

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

pub async fn list_agents(project_path: &str) -> Vec<AgentConfig> {
    let mut agents: Vec<AgentConfig> = Vec::new();

    let dirs: [(AgentScope, PathBuf); 2] = [
        (
            AgentScope::Project,
            Path::new(project_path).join(".claude").join("agents"),
        ),
        (
            AgentScope::Global,
            home_dir().join(".claude").join("agents"),
        ),
    ];

    for (scope, dir) in dirs {
        let entries = match read_dir_names(&dir).await {
            Some(e) => e,
            None => continue,
        };

        for entry in entries {
            if !entry.ends_with(".md") {
                continue;
            }
            let file_path = dir.join(&entry);
            let raw = match fs::read_to_string(&file_path).await {
                Ok(r) => r,
                Err(_) => continue, /* expected: unreadable file */
            };
            let name = entry.strip_suffix(".md").unwrap_or(&entry).to_string();
            let description = agent_description(&raw);
            let id = format!("{ADAPTER_ID}:{}:agent:{name}", agent_scope_str(scope));

            agents.push(AgentConfig {
                id,
                adapter_id: ADAPTER_ID.to_string(),
                name,
                description,
                scope,
                file_path: file_path.to_string_lossy().into_owned(),
                content: raw,
            });
        }
    }

    agents
}

pub async fn create_skill(
    project_path: &str,
    input: &CreateSkillInput,
) -> Result<Skill, SkillsError> {
    let base = match input.scope {
        AgentScope::Project => Path::new(project_path).join(".claude").join("skills"),
        AgentScope::Global => home_dir().join(".claude").join("skills"),
    };

    let skill_dir = base.join(&input.name);
    fs::create_dir_all(&skill_dir).await?;

    let content = build_frontmatter(
        &[
            ("name", &input.display_name),
            ("description", &input.description),
        ],
        &input.content,
    );
    let file_path = skill_dir.join("SKILL.md");
    fs::write(&file_path, &content).await?;

    let id = format!(
        "{ADAPTER_ID}:{}:{}",
        agent_scope_str(input.scope),
        input.name
    );
    Ok(Skill {
        id,
        adapter_id: ADAPTER_ID.to_string(),
        name: input.name.clone(),
        display_name: input.display_name.clone(),
        description: input.description.clone(),
        scope: agent_to_skill_scope(input.scope),
        plugin_name: None,
        file_path: file_path.to_string_lossy().into_owned(),
        content,
        invocation_name: Some(input.name.clone()),
    })
}

pub async fn update_skill(
    skill_id: &str,
    project_path: &str,
    content: &str,
) -> Result<Skill, SkillsError> {
    let skills = list_skills(project_path).await;
    let skill = skills
        .into_iter()
        .find(|s| s.id == skill_id)
        .ok_or_else(|| SkillsError::SkillNotFound(skill_id.to_string()))?;

    fs::write(&skill.file_path, content).await?;

    let attributes = parse_frontmatter(content).attributes;
    Ok(Skill {
        content: content.to_string(),
        display_name: nonempty_attr(&attributes, "name").unwrap_or_else(|| skill.name.clone()),
        description: attributes.get("description").cloned().unwrap_or_default(),
        ..skill
    })
}

pub async fn delete_skill(skill_id: &str, project_path: &str) -> Result<(), SkillsError> {
    let skills = list_skills(project_path).await;
    let skill = skills
        .into_iter()
        .find(|s| s.id == skill_id)
        .ok_or_else(|| SkillsError::SkillNotFound(skill_id.to_string()))?;
    if skill.scope == SkillScope::Plugin {
        return Err(SkillsError::CannotDeletePluginSkills);
    }

    let skill_dir = Path::new(&skill.file_path)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    // `rm(dir, { recursive: true, force: true })` — force ignores a missing dir.
    let _ = fs::remove_dir_all(&skill_dir).await;
    Ok(())
}

pub async fn create_agent(
    project_path: &str,
    input: &CreateAgentInput,
) -> Result<AgentConfig, SkillsError> {
    let base = match input.scope {
        AgentScope::Project => Path::new(project_path).join(".claude").join("agents"),
        AgentScope::Global => home_dir().join(".claude").join("agents"),
    };

    fs::create_dir_all(&base).await?;
    let file_path = base.join(format!("{}.md", input.name));
    let content = format!("# {}\n\n{}", input.name, input.content);
    fs::write(&file_path, &content).await?;

    let id = format!(
        "{ADAPTER_ID}:{}:agent:{}",
        agent_scope_str(input.scope),
        input.name
    );
    Ok(AgentConfig {
        id,
        adapter_id: ADAPTER_ID.to_string(),
        name: input.name.clone(),
        description: input.description.clone(),
        scope: input.scope,
        file_path: file_path.to_string_lossy().into_owned(),
        content,
    })
}

pub async fn update_agent(
    agent_id: &str,
    project_path: &str,
    content: &str,
) -> Result<AgentConfig, SkillsError> {
    let agents = list_agents(project_path).await;
    let agent = agents
        .into_iter()
        .find(|a| a.id == agent_id)
        .ok_or_else(|| SkillsError::AgentNotFound(agent_id.to_string()))?;

    fs::write(&agent.file_path, content).await?;

    let description = agent_description(content);
    Ok(AgentConfig {
        content: content.to_string(),
        description,
        ..agent
    })
}

pub async fn delete_agent(agent_id: &str, project_path: &str) -> Result<(), SkillsError> {
    let agents = list_agents(project_path).await;
    let agent = agents
        .into_iter()
        .find(|a| a.id == agent_id)
        .ok_or_else(|| SkillsError::AgentNotFound(agent_id.to_string()))?;
    // `rm(file, { force: true })` — force ignores a missing file.
    let _ = fs::remove_file(&agent.file_path).await;
    Ok(())
}

/// `attributes['name'] || fallback` — a present-but-empty value falls back too.
fn nonempty_attr(attributes: &HashMap<String, String>, key: &str) -> Option<String> {
    attributes.get(key).filter(|v| !v.is_empty()).cloned()
}

/// Derive an agent description from the first non-blank markdown line, stripping a
/// leading `#…` heading prefix (`firstLine.replace(/^#+\s*/, '')`).
fn agent_description(raw: &str) -> String {
    let first_line = raw.split('\n').find(|l| !l.trim().is_empty()).unwrap_or("");
    if first_line.starts_with('#') {
        first_line.trim_start_matches('#').trim_start().to_string()
    } else {
        first_line.to_string()
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

    #[tokio::test]
    async fn create_then_delete_skill_round_trips() {
        let tmp = tempdir().unwrap();
        let input = CreateSkillInput {
            name: "review".to_string(),
            display_name: "Review".to_string(),
            description: "Reviews code".to_string(),
            content: "# How to review".to_string(),
            scope: AgentScope::Project,
        };
        let skill = create_skill(tmp.path().to_str().unwrap(), &input)
            .await
            .unwrap();
        assert_eq!(skill.id, "claude:project:review");
        assert!(
            skill
                .content
                .starts_with("---\nname: Review\ndescription: Reviews code\n---")
        );

        delete_skill(&skill.id, tmp.path().to_str().unwrap())
            .await
            .unwrap();
        let skills = list_skills(tmp.path().to_str().unwrap()).await;
        assert!(!skills.iter().any(|s| s.id == "claude:project:review"));
    }

    #[tokio::test]
    async fn update_skill_not_found_errors() {
        let tmp = tempdir().unwrap();
        let err = update_skill("claude:project:ghost", tmp.path().to_str().unwrap(), "x")
            .await
            .unwrap_err();
        assert_eq!(err.to_string(), "Skill not found: claude:project:ghost");
    }

    #[tokio::test]
    async fn create_and_list_agent_derives_description_from_heading() {
        let tmp = tempdir().unwrap();
        let input = CreateAgentInput {
            name: "planner".to_string(),
            description: "Plans work".to_string(),
            content: "Body text".to_string(),
            scope: AgentScope::Project,
        };
        let agent = create_agent(tmp.path().to_str().unwrap(), &input)
            .await
            .unwrap();
        assert_eq!(agent.id, "claude:project:agent:planner");
        assert_eq!(agent.content, "# planner\n\nBody text");

        let agents = list_agents(tmp.path().to_str().unwrap()).await;
        let planner = agents
            .iter()
            .find(|a| a.name == "planner")
            .expect("planner");
        // First non-blank line "# planner" → heading prefix stripped.
        assert_eq!(planner.description, "planner");
    }

    #[tokio::test]
    async fn delete_plugin_skill_message_shape() {
        // A plugin-scoped skill id never resolves under a fresh project, so the
        // not-found guard fires first; assert the plugin-guard message shape directly.
        assert_eq!(
            SkillsError::CannotDeletePluginSkills.to_string(),
            "Cannot delete plugin skills"
        );
    }
}

// PORT STATUS: src/plugins/builtin/claude/skills.ts (261 lines)
// confidence: high
// todos: 0
// notes: async fs → tokio::fs (readdir→read_dir collected to names first, realpath→
// notes: canonicalize, rm recursive/force → remove_dir_all/remove_file with the error
// notes: swallowed for `force`). Map<string,Skill> insertion-order dedupe → SkillMap
// notes: (order Vec + HashMap). `attributes['name'] || x` uses nonempty_attr (empty
// notes: string falls back, matching JS falsy). Thrown Errors → SkillsError enum
// notes: preserving the "Skill/Agent not found: …" / "Cannot delete plugin skills"
// notes: strings (they cross the wire). No dedicated TS test file; sanity tests cover
// notes: list/create/delete/update + agent-description. NOTE: serde_json has no
// notes: preserve_order feature, so installed_plugins.json key iteration is sorted,
// notes: not insertion-order (no test/fixture observes plugin ordering).
