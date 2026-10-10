//! Path helpers for discovering Claude's own external session JSONL files under
//! `~/.claude/projects/<encoded>/`.

use std::path::Path;

use dirs::home_dir;

/// basename (minus `.jsonl`) is a UUID — skips progress.jsonl, queue-operation.jsonl, etc.
pub(crate) fn is_uuid_jsonl(filename: &str) -> bool {
    let Some(stem) = filename.strip_suffix(".jsonl") else {
        return false;
    };
    mainframe_types::paths::is_uuid(stem)
}

pub(crate) fn projects_root() -> String {
    home_dir()
        .unwrap_or_default()
        .join(".claude")
        .join("projects")
        .to_string_lossy()
        .to_string()
}

/// Resolve symlinks before encoding, falling back to the input if realpath fails.
pub(crate) async fn canonicalize_project_path(p: &str) -> String {
    // Unicode NFC normalization is absent, so paths with combining marks may
    // encode differently from the CLI. ASCII paths are unaffected.
    let nfc = p.to_string();
    match tokio::fs::canonicalize(&nfc).await {
        Ok(rp) => rp.to_string_lossy().to_string(),
        Err(_) => nfc, // project path may not exist on disk (still encode it)
    }
}

/// Discover every encoded dir under ~/.claude/projects whose prefix matches the project.
pub(crate) async fn discover_project_dirs(project_path: &str) -> Vec<String> {
    let root = projects_root();
    let encoded_prefix = mainframe_types::paths::encode_claude_project_path(project_path);
    let mut entries = match tokio::fs::read_dir(&root).await {
        Ok(e) => e,
        Err(_) => return Vec::new(), // no Claude session dir for this project
    };
    let mut out: Vec<String> = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == encoded_prefix || name.starts_with(&format!("{encoded_prefix}-")) {
            out.push(Path::new(&root).join(&name).to_string_lossy().to_string());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_path_replaces_every_non_alphanumeric() {
        assert_eq!(
            mainframe_types::paths::encode_claude_project_path("/Users/x/my_proj.v2"),
            "-Users-x-my-proj-v2"
        );
    }

    #[test]
    fn is_uuid_jsonl_accepts_uuid() {
        assert!(is_uuid_jsonl("3f2504e0-4f89-41d3-9a0c-0305e82c3301.jsonl"));
    }

    #[test]
    fn is_uuid_jsonl_rejects_non_uuid() {
        assert!(!is_uuid_jsonl("progress.jsonl"));
        assert!(!is_uuid_jsonl("queue-operation.jsonl"));
    }

    #[test]
    fn is_uuid_jsonl_rejects_non_jsonl() {
        assert!(!is_uuid_jsonl("3f2504e0-4f89-41d3-9a0c-0305e82c3301.json"));
    }

    #[test]
    fn cwd_belongs_to_project_cases() {
        assert!(mainframe_types::paths::cwd_belongs_to_project(
            Some("/a/proj"),
            "/a/proj"
        ));
        assert!(mainframe_types::paths::cwd_belongs_to_project(
            Some("/a/proj/sub"),
            "/a/proj"
        ));
        assert!(!mainframe_types::paths::cwd_belongs_to_project(
            Some("/a/proj-web"),
            "/a/proj"
        ));
        assert!(!mainframe_types::paths::cwd_belongs_to_project(
            None, "/a/proj"
        ));
    }
}
