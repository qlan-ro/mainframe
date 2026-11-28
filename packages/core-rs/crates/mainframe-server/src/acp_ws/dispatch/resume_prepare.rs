use crate::ctx::AppCtx;
use mainframe_acp::resume::ResumePort;
use mainframe_acp::revision_log::RevisionLog;
use mainframe_acp::{ResumeOptions, ResumeReplay, dispatch_resume_with};
use mainframe_types::acp::extensions::RevisionCursor;
use mainframe_types::acp::jsonrpc::{JsonRpcRequest, JsonRpcResponse};
use std::sync::Mutex;

pub(super) struct PreparedResume {
    pub cache_request: JsonRpcRequest,
    pub cache_validation: Option<mainframe_chat::HistoryValidation>,
    pub from_cache: bool,
    /// Set when the reply came from the adapter's pages: no tail was read or
    /// will be stored from it, so this first-window request (and its options)
    /// is stored once the history is complete (`complete_history`).
    pub tail_request: Option<(JsonRpcRequest, ResumeOptions)>,
    pub response: JsonRpcResponse,
    pub replay: ResumeReplay,
}

pub(super) async fn prepare_resume(
    request: JsonRpcRequest,
    session_id: Option<&str>,
    ctx: &AppCtx,
    ports: &dyn ResumePort,
    revision_log: Option<(&Mutex<RevisionLog>, RevisionCursor)>,
    options: ResumeOptions,
) -> PreparedResume {
    let cache_validation = session_id.and_then(|id| ctx.chat.chat_manager.history_validation(id));
    let cache_request = request.clone();
    let cached = ctx
        .chat
        .facade_hub
        .persisted_resume(
            &ctx.chat.chat_manager,
            &request,
            options,
            revision_log.as_ref().map(|(_, cursor)| cursor),
        )
        .await;
    let from_tail = cached.is_some();
    let cached = match cached {
        Some(cached) => Some(cached),
        None => {
            ctx.chat
                .facade_hub
                .adapter_window_resume(
                    &ctx.chat.chat_manager,
                    &request,
                    options,
                    revision_log.as_ref().map(|(_, cursor)| cursor),
                )
                .await
        }
    };
    let from_cache = cached.is_some();
    let from_pages = from_cache && !from_tail;
    let (response, replay) = match cached {
        Some(cached) => cached,
        None => dispatch_resume_with(request, ports, revision_log, options).await,
    };

    let tail_request = from_pages.then(|| (cache_request.clone(), options));
    PreparedResume {
        cache_request,
        cache_validation,
        from_cache,
        tail_request,
        response,
        replay,
    }
}

/// Loads the chat in full behind a windowed reply. `tail` (the first-window
/// request and its options) is set when the reply came from adapter pages:
/// the loaded history then becomes the chat's persisted tail.
pub(super) fn complete_history(
    ctx: std::sync::Arc<AppCtx>,
    chat_id: String,
    tail: Option<(JsonRpcRequest, ResumeOptions)>,
) {
    tokio::spawn(async move {
        let manager = &ctx.chat.chat_manager;
        manager.load_chat(&chat_id).await;
        manager.publish_initial_history_state(&chat_id);
        if let Some((request, options)) = tail {
            ctx.chat
                .facade_hub
                .persist_loaded_tail(manager, &request, options)
                .await;
        }
    });
}
