//! Agent listing + CRUD: `.claude/agents/*.md`. The description shown in the
//! `@` picker is derived by `crate::agent_description` (todo #317) — frontmatter
//! first, heading heuristic as the no-frontmatter fallback.

use std::path::{Path, PathBuf};

use mainframe_types::skill::{AgentConfig, AgentScope, CreateAgentInput};
use tokio::fs;

use crate::agent_description::derive_agent_description;

use super::{ADAPTER_ID, SkillsError, agent_scope_str, home_dir, read_dir_names};

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
            let derived = derive_agent_description(&raw);
            let id = format!("{ADAPTER_ID}:{}:agent:{name}", agent_scope_str(scope));

            agents.push(AgentConfig {
                id,
                adapter_id: ADAPTER_ID.to_string(),
                name,
                description: derived.summary,
                full_description: derived.full,
                scope,
                file_path: file_path.to_string_lossy().into_owned(),
                content: raw,
            });
        }
    }

    agents
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
        // No frontmatter is written for a freshly created agent (Decision D5),
        // so there is nothing declared to carry as the complete value.
        full_description: None,
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

    let derived = derive_agent_description(content);
    Ok(AgentConfig {
        content: content.to_string(),
        description: derived.summary,
        full_description: derived.full,
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const BLOCK_SCALAR_AGENT: &str = include_str!("../__fixtures__/agent-block-scalar.md");

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
    async fn list_agents_carries_full_description_alongside_the_summary() {
        let tmp = tempdir().unwrap();
        let agents_dir = tmp.path().join(".claude").join("agents");
        fs::create_dir_all(&agents_dir).await.unwrap();
        fs::write(agents_dir.join("todo317-planner.md"), BLOCK_SCALAR_AGENT)
            .await
            .unwrap();

        let agents = list_agents(tmp.path().to_str().unwrap()).await;
        let planner = agents
            .iter()
            .find(|a| a.scope == AgentScope::Project && a.name == "todo317-planner")
            .expect("todo317-planner agent");

        assert_eq!(
            planner.description,
            "Use this agent to write a spec or an implementation plan from an approved brainstorm/design."
        );
        let full = planner
            .full_description
            .as_deref()
            .expect("full description");
        assert!(full.contains("<example>"));
        assert!(full.contains("Examples:"));
    }
}
