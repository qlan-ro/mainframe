use super::*;
use mainframe_adapter_api::{AdapterError, AdapterSession};

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
        let before = Self::fingerprint(session, context).await;
        if let Some(fingerprint) = &before
            && let Some(snapshot) = self.read_candidate(chat_id, fingerprint).await
            && session
                .validate_history_state(&snapshot.adapter_state)
                .await
            && Self::fingerprint(session, context).await.as_ref() == Some(fingerprint)
        {
            tracing::debug!(chat_id, "restored history snapshot");
            return Ok(snapshot.messages);
        }
        let messages = session.load_history().await?;
        if !messages.is_empty()
            && let Some(fingerprint) = before
            && Self::fingerprint(session, context).await.as_ref() == Some(&fingerprint)
            && let Some(dependencies) = session.history_dependencies()
            && dependencies_current(&dependencies).await
            && session
                .validate_history_state(&session.history_state())
                .await
        {
            self.write_in_background(
                chat_id.to_owned(),
                fingerprint,
                messages.clone(),
                dependencies,
                session.history_state(),
            );
        }
        Ok(messages)
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
