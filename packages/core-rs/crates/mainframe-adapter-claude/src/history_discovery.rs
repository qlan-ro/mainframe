use super::*;
use crate::history_source_index::HistorySourceIndex;

pub(crate) async fn discover_session_jsonl_files(
    session_id: &str,
    project_path: &str,
    session_file_path: Option<&str>,
) -> DiscoveredFiles {
    discover_indexed_session_files(session_id, project_path, session_file_path, None).await
}

pub(crate) async fn discover_indexed_session_files(
    session_id: &str,
    project_path: &str,
    session_file_path: Option<&str>,
    index: Option<&HistorySourceIndex>,
) -> DiscoveredFiles {
    let SessionJsonlPath {
        jsonl_path: derived,
        project_dir,
    } = get_session_jsonl_path(session_id, project_path);
    let jsonl_path =
        match locate_claude_transcript(session_id, project_path, session_file_path).await {
            Some(TranscriptLocation::Present(path)) => path,
            _ => return DiscoveredFiles::missing(derived),
        };
    let directory = Path::new(&jsonl_path)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or(project_dir);
    discover_alongside(session_id, jsonl_path, &directory, index).await
}

pub(crate) async fn discover_session_jsonl_files_in_dir(
    session_id: &str,
    project_dir: &str,
) -> DiscoveredFiles {
    discover_indexed_files_in_dir(session_id, project_dir, None).await
}

pub(crate) async fn discover_indexed_files_in_dir(
    session_id: &str,
    project_dir: &str,
    index: Option<&HistorySourceIndex>,
) -> DiscoveredFiles {
    let path = Path::new(project_dir)
        .join(format!("{session_id}.jsonl"))
        .to_string_lossy()
        .into_owned();
    if tokio::fs::metadata(&path).await.is_err() {
        return DiscoveredFiles::missing(path);
    }
    discover_alongside(session_id, path, project_dir, index).await
}

async fn discover_alongside(
    session: &str,
    primary: String,
    directory: &str,
    index: Option<&HistorySourceIndex>,
) -> DiscoveredFiles {
    let mut all_files = vec![primary.clone()];
    let (siblings, mut complete) = match index {
        Some(index) => match index.related_files(Path::new(directory), session).await {
            Some(files) => (files, true),
            None => (scan_siblings(directory, session).await.0, false),
        },
        None => scan_siblings(directory, session).await,
    };
    let self_name = format!("{session}.jsonl");
    all_files.extend(siblings.into_iter().filter(|path| {
        Path::new(path)
            .file_name()
            .is_none_or(|name| name != self_name.as_str())
    }));
    let (subagents, children_complete) = subagent_files(directory, session).await;
    complete &= children_complete;
    all_files.extend(subagents.iter().cloned());
    DiscoveredFiles {
        primary_path: primary,
        all_files,
        subagent_files: subagents.into_iter().collect(),
        complete,
    }
}

async fn scan_siblings(directory: &str, session: &str) -> (Vec<String>, bool) {
    let Ok(mut entries) = tokio::fs::read_dir(directory).await else {
        return (Vec::new(), false);
    };
    let mut files = Vec::new();
    loop {
        let entry = match entries.next_entry().await {
            Ok(Some(entry)) => entry,
            Ok(None) => return (files, true),
            Err(_) => return (files, false),
        };
        let path = entry.path();
        if path
            .extension()
            .is_some_and(|extension| extension == "jsonl")
        {
            let path = path.to_string_lossy().into_owned();
            if belongs_to_session(&path, session).await {
                files.push(path);
            }
        }
    }
}

async fn subagent_files(directory: &str, session: &str) -> (Vec<String>, bool) {
    let directory = Path::new(directory).join(session).join("subagents");
    let mut entries = match tokio::fs::read_dir(directory).await {
        Ok(entries) => entries,
        Err(error) => return (Vec::new(), error.kind() == std::io::ErrorKind::NotFound),
    };
    let mut files = Vec::new();
    loop {
        match entries.next_entry().await {
            Ok(Some(entry))
                if entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "jsonl") =>
            {
                files.push(entry.path().to_string_lossy().into_owned())
            }
            Ok(Some(_)) => {}
            Ok(None) => return (files, true),
            Err(_) => return (files, false),
        }
    }
}

async fn belongs_to_session(path: &str, session: &str) -> bool {
    if let Some(mut lines) = open_lines(path).await {
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            return serde_json::from_str::<Value>(&line)
                .ok()
                .is_some_and(|first| {
                    first.get("sessionId").and_then(Value::as_str) == Some(session)
                });
        }
    }
    false
}
