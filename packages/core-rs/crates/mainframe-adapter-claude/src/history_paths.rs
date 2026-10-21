use super::*;

#[derive(serde::Deserialize)]
struct EntryKind {
    #[serde(rename = "type")]
    kind: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanEntry {
    #[serde(rename = "type")]
    kind: Option<String>,
    tool_use_result: Option<PlanResult>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanResult {
    plan: Option<String>,
    file_path: Option<String>,
}
pub(crate) async fn extract_plan_file_paths(
    session_id: &str,
    project_path: &str,
    session_file_path: Option<&str>,
) -> Vec<String> {
    let discovered =
        discover_session_jsonl_files(session_id, project_path, session_file_path).await;
    let project_dir = get_session_jsonl_path(session_id, project_path).project_dir;
    plan_file_paths_from(&discovered, &project_dir).await
}
pub(crate) async fn extract_plan_file_paths_in_dir(
    session_id: &str,
    project_dir: &str,
) -> Vec<String> {
    let discovered = discover_session_jsonl_files_in_dir(session_id, project_dir).await;
    plan_file_paths_from(&discovered, project_dir).await
}
async fn plan_file_paths_from(discovered: &DiscoveredFiles, project_dir: &str) -> Vec<String> {
    if discovered.all_files.is_empty() {
        return Vec::new();
    }
    let mut plan_files: Vec<String> = Vec::new();
    for file in &discovered.all_files {
        let Some(mut lines) = open_lines(file).await else {
            continue;
        };
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let entry: PlanEntry = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if entry.kind.as_deref() != Some("user") {
                continue;
            }
            if let Some(PlanResult {
                plan: Some(_),
                file_path: Some(path),
            }) = entry.tool_use_result
            {
                plan_files.push(path_resolve(project_dir, &path));
            }
        }
    }
    plan_files
}
pub(crate) async fn extract_skill_file_paths(
    session_id: &str,
    project_path: &str,
    session_file_path: Option<&str>,
) -> Vec<SkillFileEntry> {
    let discovered =
        discover_session_jsonl_files(session_id, project_path, session_file_path).await;
    skill_file_paths_from(&discovered, project_path).await
}
pub(crate) async fn extract_skill_file_paths_in_dir(
    session_id: &str,
    project_dir: &str,
    project_path: &str,
) -> Vec<SkillFileEntry> {
    let discovered = discover_session_jsonl_files_in_dir(session_id, project_dir).await;
    skill_file_paths_from(&discovered, project_path).await
}
async fn skill_file_paths_from(
    discovered: &DiscoveredFiles,
    project_path: &str,
) -> Vec<SkillFileEntry> {
    if discovered.all_files.is_empty() {
        return Vec::new();
    }
    let mut seen: HashSet<String> = HashSet::new();
    let mut cache: HashMap<String, String> = HashMap::new();
    let mut skill_files: Vec<SkillFileEntry> = Vec::new();
    for file in &discovered.all_files {
        let Some(mut lines) = open_lines(file).await else {
            continue;
        };
        while let Ok(Some(line)) = lines.next_line().await {
            for skill in skill_names(&line) {
                push_skill_file(
                    &skill,
                    project_path,
                    &mut seen,
                    &mut cache,
                    &mut skill_files,
                );
            }
        }
    }
    skill_files
}
fn skill_names(line: &str) -> Vec<String> {
    let Ok(header) = serde_json::from_str::<EntryKind>(line) else {
        return Vec::new();
    };
    if header.kind.as_deref() != Some("assistant") {
        return Vec::new();
    }
    let Ok(entry) = serde_json::from_str::<Value>(line) else {
        return Vec::new();
    };
    entry
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|block| {
            block.get("type").and_then(Value::as_str) == Some("tool_use")
                && block.get("name").and_then(Value::as_str) == Some("Skill")
        })
        .filter_map(|block| {
            block
                .get("input")
                .and_then(|input| input.get("skill"))
                .and_then(Value::as_str)
                .filter(|name| !name.is_empty())
                .map(str::to_string)
        })
        .collect()
}

fn push_skill_file(
    name: &str,
    project_path: &str,
    seen: &mut HashSet<String>,
    cache: &mut HashMap<String, String>,
    skill_files: &mut Vec<SkillFileEntry>,
) {
    let trimmed = name.trim();
    if trimmed.is_empty() || seen.contains(trimmed) {
        return;
    }
    seen.insert(trimmed.to_string());
    skill_files.push(SkillFileEntry {
        path: resolve_skill_path(Some(project_path), trimmed, Some(cache)),
        display_name: trimmed.to_string(),
    });
}
pub(super) fn path_resolve(base: &str, p: &str) -> String {
    let combined = if Path::new(p).is_absolute() {
        p.to_string()
    } else {
        format!("{base}/{p}")
    };
    let mut stack: Vec<&str> = Vec::new();
    for seg in combined.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                stack.pop();
            }
            s => stack.push(s),
        }
    }
    format!("/{}", stack.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn metadata_scans_preserve_plans_and_skills_around_large_image_results() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.jsonl");
        let entries = [
            json!({"type":"user","message":{"content":[{"type":"tool_result",
                "content":[{"type":"image","source":{"data":"A".repeat(2_000_000)}}]}]}}),
            json!({"type":"user","toolUseResult":{"plan":"the plan","filePath":"plans/p.md"}}),
            json!({"type":"assistant","message":{"content":[{"type":"tool_use",
                "name":"Skill","input":{"skill":"tdd"}}]}}),
            json!({"type":"user","toolUseResult":{"plan":false,"filePath":"ignored.md"}}),
        ];
        std::fs::write(
            &path,
            entries
                .iter()
                .map(Value::to_string)
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .unwrap();
        let discovered = DiscoveredFiles {
            primary_path: path.to_string_lossy().into_owned(),
            all_files: vec![path.to_string_lossy().into_owned()],
            subagent_files: HashSet::new(),
        };
        assert_eq!(
            plan_file_paths_from(&discovered, "/project").await,
            vec!["/project/plans/p.md"]
        );
        let skills = skill_file_paths_from(&discovered, "/project").await;
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].display_name, "tdd");
    }
}
