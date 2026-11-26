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
        let Some(data) = open_lines(file).await else {
            continue;
        };
        for line in valid_lines(&data) {
            if line.trim().is_empty() {
                continue;
            }
            let entry: PlanEntry = match serde_json::from_slice(line.as_bytes()) {
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
        let Some(data) = open_lines(file).await else {
            continue;
        };
        for line in valid_lines(&data) {
            for skill in skill_names(line) {
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
    let Ok(header) = serde_json::from_slice::<EntryKind>(line.as_bytes()) else {
        return Vec::new();
    };
    if header.kind.as_deref() != Some("assistant") {
        return Vec::new();
    }
    let Ok(entry) = serde_json::from_slice::<Value>(line.as_bytes()) else {
        return Vec::new();
    };
    skill_names_from(&entry)
}
fn skill_names_from(entry: &Value) -> Vec<String> {
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

#[derive(Default)]
pub(super) struct PathCollector {
    pub(super) files: mainframe_adapter_api::HistoryFiles,
    seen: HashSet<String>,
    cache: HashMap<String, String>,
}

impl PathCollector {
    pub(super) fn observe_plan(&mut self, line: &str, base: &str) {
        if let Ok(PlanEntry {
            kind: Some(kind),
            tool_use_result:
                Some(PlanResult {
                    plan: Some(_),
                    file_path: Some(path),
                }),
        }) = serde_json::from_slice(line.as_bytes())
            && kind == "user"
        {
            self.files.plans.push(path_resolve(base, &path));
        }
    }
    pub(super) fn observe(&mut self, entry: &Value, line: &str, base: &str, project: &str) {
        match entry["type"].as_str() {
            Some("user") if entry["toolUseResult"]["plan"].is_string() => {
                self.observe_plan(line, base);
            }
            Some("assistant") => {
                for skill in skill_names_from(entry) {
                    if serde_json::from_slice::<EntryKind>(line.as_bytes()).is_err() {
                        break;
                    }
                    push_skill_file(
                        &skill,
                        project,
                        &mut self.seen,
                        &mut self.cache,
                        &mut self.files.skills,
                    );
                }
            }
            _ => {}
        }
    }
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
#[path = "history_paths_tests.rs"]
mod tests;
