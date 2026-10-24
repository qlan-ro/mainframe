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
    let from_cache = cached.is_some();
    let (response, replay) = match cached {
        Some(cached) => cached,
        None => {
            if options.windowed_history
                && let Some(id) = session_id
            {
                ctx.chat.chat_manager.resume_transcript(id).await;
            }
            dispatch_resume_with(request, ports, revision_log, options).await
        }
    };

    PreparedResume {
        cache_request,
        cache_validation,
        from_cache,
        response,
        replay,
    }
}
