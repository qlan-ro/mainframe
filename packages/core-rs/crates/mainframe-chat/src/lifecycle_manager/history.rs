use mainframe_adapter_api::AdapterSession;
use mainframe_types::chat::ChatMessage;

pub(super) async fn load_session_history(
    chat_id: &str,
    session: &dyn AdapterSession,
    shared: &crate::chat_manager::ChatShared,
) -> Option<(Vec<ChatMessage>, usize)> {
    let started = std::time::Instant::now();
    let history = shared.load_cached_history(chat_id, session).await.ok();
    tracing::info!(
        chat_id,
        history_load_ms = started.elapsed().as_secs_f64() * 1000.0,
        "chat history loaded"
    );
    history.map(|history| (history, 0))
}

pub(super) fn restore_history(
    cache: &mut crate::message_cache::MessageCache,
    chat_id: &str,
    incoming: Vec<ChatMessage>,
) -> (Vec<ChatMessage>, bool) {
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
