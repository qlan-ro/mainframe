use std::collections::HashMap;
use std::path::Path;

use mainframe_types::skill::{AgentConfig, AgentScope, Skill, SkillScope};

const ADAPTER_ID: &str = "mock-cli";

pub async fn list_skills(project_path: &str) -> Vec<Skill> {
    let root = Path::new(project_path).join(".claude/skills");
    let mut names = directory_names(&root).await;
    names.sort();
    let mut skills = Vec::new();
    for name in names {
        let file_path = root.join(&name).join("SKILL.md");
        let Ok(content) = tokio::fs::read_to_string(&file_path).await else {
            continue;
        };
        let attrs = frontmatter_attrs(&content);
        skills.push(Skill {
            id: format!("{ADAPTER_ID}:project:{name}"),
            adapter_id: ADAPTER_ID.to_string(),
            display_name: attrs.get("name").cloned().unwrap_or_else(|| name.clone()),
            description: attrs.get("description").cloned().unwrap_or_default(),
            name: name.clone(),
            scope: SkillScope::Project,
            plugin_name: None,
            file_path: file_path.to_string_lossy().to_string(),
            content,
            invocation_name: Some(name),
        });
    }
    skills
}

pub async fn list_agents(project_path: &str) -> Vec<AgentConfig> {
    let root = Path::new(project_path).join(".claude/agents");
    let mut entries = directory_names(&root).await;
    entries.sort();
    let mut agents = Vec::new();
    for entry in entries.into_iter().filter(|entry| entry.ends_with(".md")) {
        let file_path = root.join(&entry);
        let Ok(content) = tokio::fs::read_to_string(&file_path).await else {
            continue;
        };
        let name = entry.trim_end_matches(".md").to_string();
        let description = content
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or_default()
            .trim_start_matches('#')
            .trim()
            .to_string();
        agents.push(AgentConfig {
            id: format!("{ADAPTER_ID}:project:agent:{name}"),
            adapter_id: ADAPTER_ID.to_string(),
            name,
            description,
            scope: AgentScope::Project,
            file_path: file_path.to_string_lossy().to_string(),
            content,
        });
    }
    agents
}

async fn directory_names(root: &Path) -> Vec<String> {
    let Ok(mut entries) = tokio::fs::read_dir(root).await else {
        return Vec::new();
    };
    let mut names = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        names.push(entry.file_name().to_string_lossy().to_string());
    }
    names
}

fn frontmatter_attrs(content: &str) -> HashMap<String, String> {
    if !content.starts_with("---") {
        return HashMap::new();
    }
    let Some(end) = content[3..].find("---").map(|index| index + 3) else {
        return HashMap::new();
    };
    content[3..end]
        .lines()
        .filter_map(|line| line.split_once(':'))
        .map(|(key, value)| (key.trim().to_string(), value.trim().to_string()))
        .filter(|(key, _)| !key.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn scans_only_project_skills_and_agents() {
        let temp = tempfile::tempdir().unwrap();
        let skill_dir = temp.path().join(".claude/skills/review");
        let agent_dir = temp.path().join(".claude/agents");
        tokio::fs::create_dir_all(&skill_dir).await.unwrap();
        tokio::fs::create_dir_all(&agent_dir).await.unwrap();
        tokio::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: Review carefully\ndescription: Finds regressions\n---\nBody\n",
        )
        .await
        .unwrap();
        tokio::fs::write(agent_dir.join("planner.md"), "# Plans changes\nBody\n")
            .await
            .unwrap();

        let skills = list_skills(temp.path().to_str().unwrap()).await;
        let agents = list_agents(temp.path().to_str().unwrap()).await;

        assert_eq!(skills[0].id, "mock-cli:project:review");
        assert_eq!(skills[0].display_name, "Review carefully");
        assert_eq!(agents[0].id, "mock-cli:project:agent:planner");
        assert_eq!(agents[0].description, "Plans changes");
    }
}
