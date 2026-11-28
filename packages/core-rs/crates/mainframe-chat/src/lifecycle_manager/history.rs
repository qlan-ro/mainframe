use mainframe_adapter_api::AdapterSession;
use mainframe_types::chat::ChatMessage;
use mainframe_types::sync::LockExt as _;

pub(super) async fn load_session_history(
    chat_id: &str,
    session: &dyn AdapterSession,
    shared: &crate::chat_manager::ChatShared,
) -> Option<(Vec<ChatMessage>, usize)> {
    if let Some(history) = current_history_in_memory(chat_id, session, shared).await {
        tracing::debug!(chat_id, "reused the validated history in memory");
        return Some((history, 0));
    }
    let started = std::time::Instant::now();
    let history = shared.load_cached_history(chat_id, session).await.ok();
    tracing::info!(
        chat_id,
        history_load_ms = started.elapsed().as_secs_f64() * 1000.0,
        "chat history loaded"
    );
    history.map(|history| (history, 0))
}

/// The history a read of this chat already left in memory, when nothing has
/// changed it since (same generation) and its sources still validate: a resume
/// that read the history itself is followed by the full load, which then needs
/// no second read. Hands the session the files that read collected.
async fn current_history_in_memory(
    chat_id: &str,
    session: &dyn AdapterSession,
    shared: &crate::chat_manager::ChatShared,
) -> Option<Vec<ChatMessage>> {
    let validation = shared.history_cache.validation(chat_id)?;
    let cached = {
        let messages = shared.messages.lock_recover();
        if validation.generation.is_none() || validation.generation != messages.generation(chat_id)
        {
            return None;
        }
        messages.get(chat_id)?.clone()
    };
    let context = shared.history_context(chat_id);
    if !crate::history_cache::HistorySnapshotCache::validate(
        session,
        context.as_deref(),
        &validation,
    )
    .await
    {
        return None;
    }
    if let Some(files) = validation.files {
        session.restore_history_files(files);
    }
    Some(cached)
}

/// Install `incoming` unless the history changed since `read_from` (its epoch
/// when the read began): the newer history then stays, reported unchanged.
pub(super) fn restore_history(
    cache: &mut crate::message_cache::MessageCache,
    chat_id: &str,
    incoming: Vec<ChatMessage>,
    read_from: u64,
) -> (Vec<ChatMessage>, bool) {
    if cache.history_epoch(chat_id) != read_from {
        tracing::debug!(chat_id, "kept a history written during the read");
        return (cache.get(chat_id).cloned().unwrap_or_default(), false);
    }
    if cache.get(chat_id) == Some(&incoming) {
        return (incoming, false);
    }
    let previous = cache.get(chat_id).cloned();
    cache.set(chat_id, incoming);
    let restored = cache.get(chat_id).cloned().unwrap_or_default();
    let changed = previous.as_ref() != Some(&restored);
    (restored, changed)
}

#[cfg(test)]
#[path = "history_tests.rs"]
mod tests;
