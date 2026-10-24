use std::sync::Arc;

use mainframe_acp::{ResumePort, rpc};
use mainframe_types::acp::extensions::{HistoryPageParams, HistorySearchParams};
use mainframe_types::acp::jsonrpc::{JsonRpcRequest, JsonRpcResponse};
use serde::de::DeserializeOwned;
use tracing::error;

use super::super::facade_conn::FacadeConnection;
use crate::ctx::AppCtx;

pub(super) fn start(
    request: JsonRpcRequest,
    ctx: &Arc<AppCtx>,
    connection: &Arc<FacadeConnection>,
    port: Arc<dyn ResumePort>,
) {
    if !connection.is_negotiated() {
        connection.send_json(&rpc::error_response(
            request.id,
            mainframe_acp::initialize_required(),
        ));
        return;
    }
    if request.method == "_mainframe.dev/history_page" && !connection.is_windowed_history_opted_in()
    {
        connection.send_json(&rpc::error_response(
            request.id,
            rpc::method_not_found(&request.method),
        ));
        return;
    }
    let wait = super::params_session_id(request.params.as_ref())
        .map(|id| connection.enqueue_prompt_lock(&id));
    let ctx = Arc::clone(ctx);
    let connection = Arc::clone(connection);
    tokio::spawn(async move {
        let _guard = match wait {
            Some(wait) => Some(wait.guard().await),
            None => None,
        };
        if request.method == "_mainframe.dev/history_search" {
            search(request, &connection, port.as_ref()).await;
        } else {
            page(request, &ctx, &connection, port).await;
        }
    });
}

fn parse<T: DeserializeOwned>(request: &JsonRpcRequest) -> Result<T, JsonRpcResponse> {
    serde_json::from_value(request.params.clone().unwrap_or(serde_json::Value::Null)).map_err(
        |err| rpc::error_response(request.id.clone(), rpc::invalid_params(&err.to_string())),
    )
}

async fn search(request: JsonRpcRequest, connection: &FacadeConnection, port: &dyn ResumePort) {
    let params: HistorySearchParams = match parse(&request) {
        Ok(params) => params,
        Err(error) => {
            connection.send_json(&error);
            return;
        }
    };
    let snapshot = port.resume_snapshot(&params.session_id).await;
    let result = tokio::task::spawn_blocking(move || {
        mainframe_acp::history_search::search(&snapshot.messages, &params.query)
    })
    .await;
    let response = match result {
        Ok(result) => rpc::success_response(request.id, serde_json::json!(result)),
        Err(err) => {
            error!(error = %err, chat_id = params.session_id, "history search failed");
            rpc::error_response(request.id, rpc::internal_error("history search failed"))
        }
    };
    connection.send_json(&response);
}

async fn page(
    request: JsonRpcRequest,
    ctx: &AppCtx,
    connection: &FacadeConnection,
    port: Arc<dyn ResumePort>,
) {
    let params: HistoryPageParams = match parse(&request) {
        Ok(params) => params,
        Err(error) => {
            connection.send_json(&error);
            return;
        }
    };
    let hub = &ctx.chat.facade_hub;
    let Some(stream) = hub.begin_history_page(connection, &params.session_id, &params.before)
    else {
        hub.stale_history_page(connection, &params.session_id, request.id);
        return;
    };
    let chat_id = params.session_id.clone();
    let previews = connection.is_replay_result_previews_opted_in();
    let options = mainframe_acp::history_page::PageOptions {
        previews,
        compressed: connection.is_compressed_replay_opted_in(),
        lazy_tool_images: connection.is_lazy_tool_images_opted_in(),
    };
    let seed_hub = Arc::clone(&ctx.chat.facade_hub);
    let result = tokio::spawn(async move {
        let snapshot = port.resume_snapshot(&params.session_id).await;
        tokio::task::spawn_blocking(move || {
            seed_hub.seed_history_snapshot(&params.session_id, &snapshot.messages);
            mainframe_acp::history_page::prepare(&snapshot.messages, &params, options)
        })
        .await
    })
    .await;
    match result {
        Ok(Ok(page)) => hub.finish_history_page(connection, &chat_id, request.id, stream, page),
        other => {
            error!(chat_id, error = ?other.err(), "history page failed");
            connection.forget_chat(&chat_id);
            connection.send_json(&rpc::error_response(
                request.id,
                rpc::internal_error("history page failed"),
            ));
            connection.send_json(&mainframe_acp::resync_notification(&chat_id));
        }
    }
}
