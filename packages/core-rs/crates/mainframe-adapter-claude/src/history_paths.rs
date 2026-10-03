use super::*;
pub async fn extract_plan_file_paths(
    session_id: &str,
    project_path: &str,
    session_file_path: Option<&str>,
) -> Vec<String> {
    let discovered =
        discover_session_jsonl_files(session_id, project_path, session_file_path).await;
    let project_dir = get_session_jsonl_path(session_id, project_path).project_dir;
    plan_file_paths_from(&discovered, &project_dir).await
}
pub async fn extract_plan_file_paths_in_dir(session_id: &str, project_dir: &str) -> Vec<String> {
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
            let entry: Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if entry.get("type").and_then(Value::as_str) != Some("user") {
                continue;
            }
            let tur = entry.get("toolUseResult");
            let plan_is_string = tur
                .and_then(|t| t.get("plan"))
                .map(Value::is_string)
                .unwrap_or(false);
            let file_path = tur.and_then(|t| t.get("filePath")).and_then(Value::as_str);
            if plan_is_string && let Some(fp) = file_path {
                plan_files.push(path_resolve(project_dir, fp));
            }
        }
    }
    plan_files
}
pub async fn extract_skill_file_paths(
    session_id: &str,
    project_path: &str,
    session_file_path: Option<&str>,
) -> Vec<SkillFileEntry> {
    let discovered =
        discover_session_jsonl_files(session_id, project_path, session_file_path).await;
    skill_file_paths_from(&discovered, project_path).await
}
pub async fn extract_skill_file_paths_in_dir(
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
            if line.trim().is_empty() {
                continue;
            }
            let entry: Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if entry.get("type").and_then(Value::as_str) != Some("assistant") {
                continue;
            }
            let content = match entry
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(Value::as_array)
            {
                Some(c) => c,
                None => continue,
            };
            for block in content {
                if block.get("type").and_then(Value::as_str) == Some("tool_use")
                    && block.get("name").and_then(Value::as_str) == Some("Skill")
                    && let Some(skill) = block
                        .get("input")
                        .and_then(|i| i.get("skill"))
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                {
                    push_skill_file(skill, project_path, &mut seen, &mut cache, &mut skill_files);
                }
            }
        }
    }
    skill_files
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
