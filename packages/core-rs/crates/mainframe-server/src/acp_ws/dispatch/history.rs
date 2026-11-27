use std::sync::Arc;

use mainframe_acp::{ResumePort, rpc};
use mainframe_types::acp::extensions::{
    HistoryAroundParams, HistoryPageParams, HistorySearchParams,
};
use mainframe_types::acp::jsonrpc::{JsonRpcRequest, JsonRpcResponse};
use serde::de::DeserializeOwned;
use tracing::error;

use super::super::facade_conn::FacadeConnection;
use crate::ctx::AppCtx;

#[path = "subagent_history.rs"]
mod subagent_history;

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
        if request
            .method
            .starts_with("_mainframe.dev/subagent_history_")
        {
            subagent_history::handle(request, &ctx, &connection).await;
        } else if request.method == "_mainframe.dev/history_search" {
            search(request, &connection, port.as_ref()).await;
        } else if request.method == "_mainframe.dev/history_around" {
            around(request, &connection, port.as_ref()).await;
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
    let result =
        mainframe_acp::history_search::search_chat(port, &params.session_id, &params.query).await;
    reply(connection, request.id, result, "history search");
}

async fn around(request: JsonRpcRequest, connection: &FacadeConnection, port: &dyn ResumePort) {
    let params: HistoryAroundParams = match parse(&request) {
        Ok(params) => params,
        Err(error) => {
            connection.send_json(&error);
            return;
        }
    };
    let options = mainframe_acp::history_page::PageOptions {
        previews: connection.is_replay_result_previews_opted_in(),
        compressed: connection.is_compressed_replay_opted_in(),
        lazy_tool_images: connection.is_lazy_tool_images_opted_in(),
    };
    let result = mainframe_acp::history_around::around_chat(port, &params, options).await;
    reply(connection, request.id, result, "history around");
}

fn reply<T: serde::Serialize>(
    connection: &FacadeConnection,
    id: Option<mainframe_types::acp::jsonrpc::RequestId>,
    result: Option<T>,
    what: &str,
) {
    connection.send_json(&match result {
        Some(result) => rpc::success_response(id, serde_json::json!(result)),
        None => {
            error!(what, "history read produced no result");
            rpc::error_response(id, rpc::internal_error(&format!("{what} failed")))
        }
    });
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
        let chat_id = params.session_id.clone();
        mainframe_acp::history_page::prepare_chat(port.as_ref(), &params, options, |messages| {
            seed_hub.seed_history_snapshot(&chat_id, messages);
        })
        .await
    })
    .await;
    match result {
        Ok(Some(page)) => hub.finish_history_page(connection, &chat_id, request.id, stream, page),
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
