use super::*;
pub async fn discover_session_jsonl_files(
    session_id: &str,
    project_path: &str,
    session_file_path: Option<&str>,
) -> DiscoveredFiles {
    let SessionJsonlPath {
        jsonl_path: derived_jsonl_path,
        project_dir: derived_project_dir,
    } = get_session_jsonl_path(session_id, project_path);
    let jsonl_path =
        match locate_claude_transcript(session_id, project_path, session_file_path).await {
            Some(TranscriptLocation::Present(path)) => path,
            _ => return DiscoveredFiles::missing(derived_jsonl_path),
        };
    let project_dir = Path::new(&jsonl_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(derived_project_dir);
    discover_alongside(session_id, jsonl_path, &project_dir).await
}
pub async fn discover_session_jsonl_files_in_dir(
    session_id: &str,
    project_dir: &str,
) -> DiscoveredFiles {
    let jsonl_path = Path::new(project_dir)
        .join(format!("{session_id}.jsonl"))
        .to_string_lossy()
        .to_string();
    if tokio::fs::metadata(&jsonl_path).await.is_err() {
        return DiscoveredFiles::missing(jsonl_path);
    }
    discover_alongside(session_id, jsonl_path, project_dir).await
}
async fn discover_alongside(
    session_id: &str,
    jsonl_path: String,
    project_dir: &str,
) -> DiscoveredFiles {
    let mut jsonl_files = vec![jsonl_path.clone()];
    let mut subagent_files: HashSet<String> = HashSet::new();
    let self_name = format!("{session_id}.jsonl");
    if let Ok(mut entries) = tokio::fs::read_dir(project_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".jsonl") || name == self_name {
                continue;
            }
            let file_path = Path::new(project_dir)
                .join(&name)
                .to_string_lossy()
                .to_string();
            if belongs_to_session(&file_path, session_id).await {
                jsonl_files.push(file_path);
            }
        }
    }
    let subagent_dir = Path::new(project_dir).join(session_id).join("subagents");
    if let Ok(mut sub_entries) = tokio::fs::read_dir(&subagent_dir).await {
        while let Ok(Some(entry)) = sub_entries.next_entry().await {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".jsonl") {
                continue;
            }
            let file_path = subagent_dir.join(&name).to_string_lossy().to_string();
            jsonl_files.push(file_path.clone());
            subagent_files.insert(file_path);
        }
    }
    DiscoveredFiles {
        primary_path: jsonl_path,
        all_files: jsonl_files,
        subagent_files,
    }
}

async fn belongs_to_session(file_path: &str, session_id: &str) -> bool {
    if let Some(mut lines) = open_lines(file_path).await {
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            return serde_json::from_str::<Value>(&line)
                .ok()
                .is_some_and(|first| {
                    first.get("sessionId").and_then(Value::as_str) == Some(session_id)
                });
        }
    }
    false
}
