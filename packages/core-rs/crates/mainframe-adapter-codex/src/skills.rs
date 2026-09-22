use std::path::Path;

use mainframe_adapter_api::AdapterError;
use mainframe_types::skill::{Skill, SkillScope};
use serde::Deserialize;
use serde_json::json;

use crate::session::spawn_temp_app_server;

#[derive(Deserialize)]
struct SkillsResponse {
    data: Vec<SkillsEntry>,
}

#[derive(Deserialize)]
struct SkillsEntry {
    skills: Vec<SkillMetadata>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillMetadata {
    name: String,
    description: String,
    path: String,
    scope: String,
    enabled: bool,
    plugin_id: Option<String>,
    interface: Option<SkillInterface>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillInterface {
    display_name: Option<String>,
}

pub async fn list_skills(
    project_path: &str,
    resolved_path: &str,
) -> Result<Vec<Skill>, AdapterError> {
    let client =
        spawn_temp_app_server("codex", Some(Path::new(project_path)), false, resolved_path).await?;
    let response = client
        .request(
            "skills/list",
            Some(json!({ "cwds": [project_path], "forceReload": true })),
        )
        .await;
    client.close();
    let response = response.map_err(|error| AdapterError::Message(error.0))?;
    let response: SkillsResponse = serde_json::from_value(response)
        .map_err(|error| AdapterError::Message(error.to_string()))?;
    Ok(response
        .data
        .into_iter()
        .flat_map(|entry| entry.skills)
        .filter(|skill| skill.enabled)
        .map(|skill| {
            let scope = if skill.plugin_id.is_some() {
                SkillScope::Plugin
            } else if skill.scope == "repo" {
                SkillScope::Project
            } else {
                SkillScope::Global
            };
            Skill {
                id: format!("codex:{}", skill.path),
                adapter_id: "codex".into(),
                display_name: skill
                    .interface
                    .and_then(|interface| interface.display_name)
                    .unwrap_or_else(|| skill.name.clone()),
                invocation_name: Some(skill.name.clone()),
                name: skill.name,
                description: skill.description,
                scope,
                plugin_name: skill.plugin_id,
                file_path: skill.path,
                content: String::new(),
            }
        })
        .collect())
}
