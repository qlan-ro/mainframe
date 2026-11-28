use super::*;
use mainframe_adapter_api::{AdapterError, AdapterSession};
use mainframe_types::sync::LockExt as _;

/// A fresh parse whose stamps held still across the read, ready to persist.
pub(crate) struct ParsedHistory {
    pub(crate) messages: Vec<ChatMessage>,
    pub(crate) validation: crate::HistoryValidation,
}

impl HistorySnapshotCache {
    pub(crate) async fn fingerprint(
        session: &dyn AdapterSession,
        context: Option<&str>,
    ) -> Option<HistoryFingerprint> {
        let context = context?;
        let mut fingerprint = HistoryFingerprint::compute(&session.history_sources().await).await?;
        fingerprint.context = context.to_owned();
        Some(fingerprint)
    }

    pub(crate) async fn load(
        self: &Arc<Self>,
        chat_id: &str,
        session: &dyn AdapterSession,
        context: Option<&str>,
    ) -> Result<Vec<ChatMessage>, AdapterError> {
        self.validated.lock_recover().remove(chat_id);
        let before = Self::fingerprint(session, context).await;
        if let Some(fingerprint) = &before
            && let Some(snapshot) = self.read_candidate(chat_id, fingerprint).await
            && session
                .validate_history_state(&snapshot.adapter_state)
                .await
            && Self::fingerprint(session, context).await.as_ref() == Some(fingerprint)
        {
            let mut validation = crate::HistoryValidation::new(
                snapshot.fingerprint,
                snapshot.dependencies,
                snapshot.adapter_state,
            );
            validation.files = snapshot.history_files.clone();
            if let Some(files) = snapshot.history_files {
                session.restore_history_files(files);
            }
            self.remember(chat_id, validation);
            tracing::debug!(chat_id, "restored history snapshot");
            return Ok(snapshot.messages);
        }
        let messages = session.load_history().await?;
        if let Some(fingerprint) = before
            && let Some((validation, snapshot)) =
                Self::settled(session, context, fingerprint, messages.clone()).await
        {
            self.remember(chat_id, validation);
            self.write_in_background(chat_id.to_owned(), snapshot);
        }
        Ok(messages)
    }

    /// Parses the transcript again, ignoring any stored snapshot, and writes
    /// the result before returning. Used when a turn has made the stored
    /// snapshot stale; leaves the in-memory validation of a hot chat alone.
    /// `None` when nothing could be cached (no stable stamps, empty history,
    /// a failed read or a failed write).
    pub(crate) async fn refresh(
        &self,
        chat_id: &str,
        session: &dyn AdapterSession,
        context: Option<&str>,
        background: bool,
    ) -> Option<ParsedHistory> {
        let before = Self::fingerprint(session, context).await?;
        let read = if background {
            session.load_history_background().await
        } else {
            session.load_history().await
        };
        let messages = match read {
            Ok(messages) => messages,
            Err(err) => {
                tracing::warn!(error = %err, chat_id, "history refresh read failed");
                return None;
            }
        };
        let (validation, snapshot) = Self::settled(session, context, before, messages).await?;
        let messages = self.write_logged(chat_id, snapshot).await?;
        Some(ParsedHistory {
            messages,
            validation,
        })
    }

    /// The validation and snapshot for `messages` when every stamp the load
    /// depends on held still across it; `None` means "do not cache".
    async fn settled(
        session: &dyn AdapterSession,
        context: Option<&str>,
        fingerprint: HistoryFingerprint,
        messages: Vec<ChatMessage>,
    ) -> Option<(crate::HistoryValidation, Snapshot)> {
        if messages.is_empty()
            || Self::fingerprint(session, context).await.as_ref() != Some(&fingerprint)
        {
            return None;
        }
        let dependencies = session.history_dependencies()?;
        let adapter_state = session.history_state();
        if !dependencies_current(&dependencies).await
            || !session.validate_history_state(&adapter_state).await
        {
            return None;
        }
        let mut validation = crate::HistoryValidation::new(
            fingerprint.clone(),
            dependencies.clone(),
            adapter_state.clone(),
        );
        validation.files = session.peek_history_files();
        let snapshot = Snapshot {
            fingerprint,
            messages,
            dependencies,
            adapter_state,
            history_files: session.peek_history_files(),
        };
        Some((validation, snapshot))
    }
}

async fn dependencies_current(sources: &[mainframe_adapter_api::HistoryDependency]) -> bool {
    for source in sources {
        if !source.is_current().await {
            return false;
        }
    }
    true
}
