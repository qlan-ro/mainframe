use mainframe_adapter_api::AdapterSession;
use mainframe_types::chat::ChatMessage;

pub(super) async fn load_session_history(
    chat_id: &str,
    session: &dyn AdapterSession,
) -> Option<(Vec<ChatMessage>, usize)> {
    let started = std::time::Instant::now();
    let history = session.load_history().await.ok();
    tracing::info!(
        chat_id,
        history_load_ms = started.elapsed().as_secs_f64() * 1000.0,
        "chat history loaded"
    );
    history.map(|history| {
        let remapped = history
            .into_iter()
            .map(|mut message| {
                message.chat_id = chat_id.to_string();
                message
            })
            .collect();
        (remapped, 0)
    })
}
