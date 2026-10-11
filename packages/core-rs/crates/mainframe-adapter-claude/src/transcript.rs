//! The canonical `~/.claude/projects/<encoded>/<sessionId>.jsonl` path helper
//! plus the transcript-presence probe used by degraded-chat recovery.

use std::path::{Path, PathBuf};

use dirs::home_dir;
use mainframe_types::transcript::TranscriptLocation;
use tokio::fs;

/// `{ jsonlPath, projectDir }` — the canonical transcript path pair for a session.
pub struct SessionJsonlPath {
    pub jsonl_path: String,
    pub project_dir: String,
}

/// `~/.claude/projects` — the parent of every per-project transcript directory.
fn claude_projects_root() -> PathBuf {
    home_dir()
        .unwrap_or_default()
        .join(".claude")
        .join("projects")
}

/// Canonical `~/.claude/projects/<encoded>/<sessionId>.jsonl` path for a session.
pub fn get_session_jsonl_path(session_id: &str, project_path: &str) -> SessionJsonlPath {
    let encoded = mainframe_types::paths::encode_claude_project_path(project_path);
    let project_dir = claude_projects_root().join(&encoded);
    let jsonl_path = project_dir.join(format!("{session_id}.jsonl"));
    SessionJsonlPath {
        jsonl_path: jsonl_path.to_string_lossy().to_string(),
        project_dir: project_dir.to_string_lossy().to_string(),
    }
}

/// Claude's transcript location for `session_id`: the stored `session_file_path`
/// when it exists, else the path derived from the project path, else whichever
/// project directory holds it, else `Missing`. Claude's layout is always known,
/// so this never returns `None`. The stored and derived paths both lag a
/// relocation: the CLI moves the transcript into the new cwd's project
/// directory whenever the session changes directory (`EnterWorktree`,
/// `ExitWorktree`, `/cd`) and does not tell us, so only the scan finds it.
pub async fn locate_claude_transcript(
    session_id: &str,
    project_path: &str,
    session_file_path: Option<&str>,
) -> Option<TranscriptLocation> {
    let derived = get_session_jsonl_path(session_id, project_path).jsonl_path;
    let candidates: Vec<String> = [session_file_path.map(str::to_string), Some(derived)]
        .into_iter()
        .flatten()
        .filter(|p| !p.is_empty())
        .collect();
    for candidate in candidates {
        // A readable file's `metadata` succeeds, a missing one errors — the
        // presence signal for the .jsonl transcripts.
        if fs::metadata(&candidate).await.is_ok() {
            return Some(TranscriptLocation::Present(candidate));
        }
    }
    match find_in_project_dirs(&claude_projects_root(), session_id).await {
        Some(relocated) => Some(TranscriptLocation::Present(relocated)),
        None => Some(TranscriptLocation::Missing),
    }
}

/// `<root>/*/<session_id>.jsonl`, for a transcript the CLI moved to a project
/// directory we cannot derive. Session ids are UUIDs, so any hit is this
/// session's. An id that is not a plain file name is never joined onto a path.
async fn find_in_project_dirs(root: &Path, session_id: &str) -> Option<String> {
    if session_id.is_empty()
        || !session_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return None;
    }
    let file_name = format!("{session_id}.jsonl");
    let mut entries = match fs::read_dir(root).await {
        Ok(entries) => entries,
        Err(err) => {
            tracing::debug!(%err, root = %root.display(), "claude projects dir unreadable");
            return None;
        }
    };
    loop {
        let entry = match entries.next_entry().await {
            Ok(Some(entry)) => entry,
            Ok(None) => return None,
            Err(err) => {
                tracing::warn!(%err, root = %root.display(), "claude projects dir scan failed");
                return None;
            }
        };
        let candidate = entry.path().join(&file_name);
        if fs::metadata(&candidate).await.is_ok_and(|m| m.is_file()) {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
}

/// Whether the CLI transcript for `sessionId` still exists on disk — re-expressed
/// as a single `locate_claude_transcript` probe so presence and location never
/// drift out of sync.
pub(crate) async fn is_claude_transcript_present(
    session_id: &str,
    project_path: &str,
    session_file_path: Option<&str>,
) -> bool {
    matches!(
        locate_claude_transcript(session_id, project_path, session_file_path).await,
        Some(TranscriptLocation::Present(_))
    )
}

#[cfg(test)]
#[path = "transcript_tests.rs"]
mod tests;
