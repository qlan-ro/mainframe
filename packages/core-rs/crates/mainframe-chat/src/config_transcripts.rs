//! Worktree moves relocate the chat's Claude transcripts. Claude keys its
//! transcripts by project directory, so a chat moved into (or between)
//! worktrees must take every Claude session it owns along, not only the
//! active one: a provider switch can leave earlier Claude segments behind,
//! and returning to one resumes it from the new directory. Codex rollouts
//! are not project-keyed, and borrowed sessions belong to another chat.

use mainframe_services::workspace::get_claude_project_dir;

use crate::config_manager::ConfigManagerDeps;
use crate::event_handler::compute_session_file_path;

const CLAUDE: &str = "claude";

/// One provider session a chat owns (never a borrowed one).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnedNativeSession {
    pub native_ref: String,
    pub adapter_id: String,
    pub session_id: String,
}

/// The chat's session as `ActiveChat` mirrors it.
pub struct ActiveSession<'a> {
    pub adapter_id: &'a str,
    pub session_id: Option<&'a str>,
}

/// Moves every owned Claude transcript from `old_dir`'s project directory to
/// `new_dir`'s and records each new path. Returns the active session's new
/// path, for the live cell and the mirror. A deps impl without segments
/// reports no owned sessions; the active one is then moved as before.
/// Stops at the first failure: rows already moved keep their new paths.
pub async fn relocate_claude_transcripts<D: ConfigManagerDeps>(
    deps: &D,
    chat_id: &str,
    active: ActiveSession<'_>,
    old_dir: &str,
    new_dir: &str,
) -> Result<Option<String>, String> {
    let sessions = claude_sessions(deps, chat_id, &active);
    let old_project = get_claude_project_dir(old_dir);
    let new_project = get_claude_project_dir(new_dir);
    let mut active_path = None;
    for (native_ref, session_id) in sessions {
        deps.move_claude_session_files(
            &session_id,
            &old_project.to_string_lossy(),
            &new_project.to_string_lossy(),
        )
        .await?;
        let path = compute_session_file_path(new_dir, &session_id);
        if let Some(native_ref) = &native_ref {
            deps.set_native_session_file_path(native_ref, &path);
        }
        if active.session_id == Some(session_id.as_str()) {
            active_path = Some(path);
        }
    }
    Ok(active_path)
}

/// (native row, session id) for each Claude session to move.
fn claude_sessions<D: ConfigManagerDeps>(
    deps: &D,
    chat_id: &str,
    active: &ActiveSession<'_>,
) -> Vec<(Option<String>, String)> {
    let owned: Vec<(Option<String>, String)> = deps
        .owned_native_sessions(chat_id)
        .into_iter()
        .filter(|s| s.adapter_id == CLAUDE)
        .map(|s| (Some(s.native_ref), s.session_id))
        .collect();
    if !owned.is_empty() {
        return owned;
    }
    match active.session_id {
        Some(id) if active.adapter_id == CLAUDE => vec![(None, id.to_string())],
        _ => Vec::new(),
    }
}

#[cfg(test)]
#[path = "config_transcripts_tests.rs"]
mod tests;
