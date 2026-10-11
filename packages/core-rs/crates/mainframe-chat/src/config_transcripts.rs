use crate::chat_manager::ChatManagerDeps;
#[cfg(test)]
use crate::event_handler::compute_session_file_path;

#[derive(Debug, thiserror::Error)]
pub enum RelocateError {
    #[error(transparent)]
    Adapter(#[from] mainframe_adapter_api::AdapterError),
    #[error(transparent)]
    Store(#[from] mainframe_types::seam_error::SeamError),
}

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

pub(crate) async fn relocate_transcripts(
    deps: &dyn ChatManagerDeps,
    chat_id: &str,
    active: ActiveSession<'_>,
    old_dir: &str,
    new_dir: &str,
) -> Result<Option<String>, RelocateError> {
    let owned = deps.owned_native_sessions(chat_id)?;
    let mut sessions: Vec<_> = owned
        .into_iter()
        .map(|session| {
            (
                Some(session.native_ref),
                session.adapter_id,
                session.session_id,
            )
        })
        .collect();
    if !sessions
        .iter()
        .any(|(_, adapter, _)| adapter == active.adapter_id)
        && let Some(id) = active.session_id
    {
        sessions.push((None, active.adapter_id.to_string(), id.to_string()));
    }
    let mut active_path = None;
    for (native_ref, adapter_id, session_id) in sessions {
        let Some(path) = deps
            .relocate_transcript(&adapter_id, &session_id, old_dir, new_dir)
            .await?
        else {
            continue;
        };
        if let Some(native_ref) = native_ref {
            deps.set_native_session_file_path(&native_ref, &path)?;
        }
        if active.adapter_id == adapter_id && active.session_id == Some(session_id.as_str()) {
            active_path = Some(path);
        }
    }
    Ok(active_path)
}

#[cfg(test)]
#[path = "config_transcripts_tests.rs"]
mod tests;
