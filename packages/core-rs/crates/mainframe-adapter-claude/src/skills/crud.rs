//! Skill CRUD: create/update/delete `.claude/skills/*/SKILL.md`.

use std::path::Path;

use mainframe_types::skill::{AgentScope, CreateSkillInput, Skill, SkillScope};
use tokio::fs;

use crate::frontmatter::{build_frontmatter, parse_frontmatter};

use super::{
    ADAPTER_ID, SkillsError, agent_scope_str, agent_to_skill_scope, home_dir, list_skills,
    nonempty_attr,
};

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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

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
    async fn delete_plugin_skill_message_shape() {
        // A plugin-scoped skill id never resolves under a fresh project, so the
        // not-found guard fires first; assert the plugin-guard message shape directly.
        assert_eq!(
            SkillsError::CannotDeletePluginSkills.to_string(),
            "Cannot delete plugin skills"
        );
    }
}
