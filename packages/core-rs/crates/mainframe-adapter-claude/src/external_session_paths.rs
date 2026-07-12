//! Ported from `packages/core/src/plugins/builtin/claude/external-session-paths.ts`.
//!
//! Path helpers for discovering Claude's own external session JSONL files under
//! `~/.claude/projects/<encoded>/`.

use std::path::Path;

use dirs::home_dir;

/// basename (minus `.jsonl`) is a UUID — skips progress.jsonl, queue-operation.jsonl, etc.
pub fn is_uuid_jsonl(filename: &str) -> bool {
    let Some(stem) = filename.strip_suffix(".jsonl") else {
        return false;
    };
    is_uuid(stem)
}

/// `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`
fn is_uuid(s: &str) -> bool {
    const GROUPS: [usize; 5] = [8, 4, 4, 4, 12];
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != GROUPS.len() {
        return false;
    }
    parts
        .iter()
        .zip(GROUPS.iter())
        .all(|(part, &len)| part.len() == len && part.chars().all(|c| c.is_ascii_hexdigit()))
}

/// CLI parity: replace EVERY non-alphanumeric char with '-'.
pub fn encode_path(p: &str) -> String {
    p.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

pub fn projects_root() -> String {
    home_dir()
        .unwrap_or_default()
        .join(".claude")
        .join("projects")
        .to_string_lossy()
        .to_string()
}

/// Canonicalize like the CLI before encoding: resolve symlinks (realpath) and
/// normalize Unicode (NFC). Falls back to the input if it can't be realpath'd.
pub async fn canonicalize_project_path(p: &str) -> String {
    // TODO(port): JS `p.normalize('NFC')` is skipped — no unicode-normalization
    // crate on the allowlist. ASCII paths (the common case) are unaffected;
    // non-ASCII paths with combining marks may encode differently than the CLI.
    let nfc = p.to_string();
    match tokio::fs::canonicalize(&nfc).await {
        Ok(rp) => rp.to_string_lossy().to_string(),
        Err(_) => nfc, // project path may not exist on disk (still encode it)
    }
}

/// Belongs to this project if cwd equals the root or is nested under it.
pub fn cwd_belongs_to_project(cwd: Option<&str>, project_path: &str) -> bool {
    let cwd = match cwd {
        Some(c) if !c.is_empty() => c,
        _ => return false,
    };
    if cwd == project_path {
        return true;
    }
    cwd.starts_with(&format!("{project_path}{}", std::path::MAIN_SEPARATOR))
}

/// Discover every encoded dir under ~/.claude/projects whose prefix matches the project.
pub async fn discover_project_dirs(project_path: &str) -> Vec<String> {
    let root = projects_root();
    let encoded_prefix = encode_path(project_path);
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
        assert_eq!(encode_path("/Users/x/my_proj.v2"), "-Users-x-my-proj-v2");
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
        assert!(cwd_belongs_to_project(Some("/a/proj"), "/a/proj"));
        assert!(cwd_belongs_to_project(Some("/a/proj/sub"), "/a/proj"));
        assert!(!cwd_belongs_to_project(Some("/a/proj-web"), "/a/proj"));
        assert!(!cwd_belongs_to_project(None, "/a/proj"));
    }
}

// PORT STATUS: src/plugins/builtin/claude/external-session-paths.ts (58 lines)
// confidence: high
// todos: 1
// notes: UUID_RE hand-rolled as 8-4-4-4-12 hex groups. encodePath replaces every
// non-alphanumeric (incl. dashes) with '-' — distinct from history.ts's encoding
// which keeps dashes. cwd path.sep → std::path::MAIN_SEPARATOR. realpath →
// tokio::fs::canonicalize. The 1 TODO(port): NFC normalization skipped (no crate
// on the allowlist; ASCII unaffected). All 4 TS path tests ported.
