use crate::{ctx::AppCtx, websocket::authenticate_ws_upgrade};
use axum::{
    extract::{
        ConnectInfo, Path, Query, State,
        ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use mainframe_lsp::{ClientEvent, LspClient, LspError};
use mainframe_types::http_status::StatusKind;
use serde::Deserialize;
use std::{net::SocketAddr, sync::Arc};

/// `?token=`/`?chatId=` on the LSP upgrade URL.
#[derive(Debug, Deserialize)]
pub(crate) struct LspWsQuery {
    token: Option<String>,
    #[serde(rename = "chatId")]
    chat_id: Option<String>,
}

/// The `/lsp/:projectId/:language` WS route handler. Self-authenticates (token
/// query param unless loopback), resolves the chat's scope, starts or reuses
/// the language server, then pumps the accepted socket through an
/// [`LspClient`].
pub(crate) async fn lsp_ws_handler(
    State(ctx): State<Arc<AppCtx>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Path((project_id, language)): Path<(String, String)>,
    Query(query): Query<LspWsQuery>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !authenticate_ws_upgrade(&ctx, &peer, &headers, query.token).await {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    let scope = match ctx
        .resolve_scope(&project_id, query.chat_id.as_deref())
        .await
    {
        Ok(scope) => scope,
        Err(mainframe_services::workspace::ScopeError::Database(error)) => {
            tracing::error!(%error, "LSP scope resolution failed");
            return reject_response(StatusKind::Internal);
        }
        Err(_) => return reject_response(StatusKind::NotFound),
    };
    let manager = Arc::clone(&ctx.infra.lsp_manager);
    match manager.connect(&project_id, &language, &scope.path).await {
        Ok(handle) => upgrade.on_upgrade(move |socket| async move {
            let client = manager.attach(&handle);
            tracing::info!(
                project_id,
                language,
                reattach = client.is_reattach(),
                "LSP WebSocket client connected"
            );
            pump_lsp_socket(socket, client).await;
            tracing::info!(project_id, language, "LSP WebSocket client disconnected");
        }),
        Err(error) => {
            let status = match error {
                LspError::PathNotFound { .. } | LspError::Unsupported(_) => {
                    tracing::warn!(%error, project_id, language, "LSP upgrade rejected");
                    StatusKind::NotFound
                }
                _ => {
                    tracing::error!(%error, project_id, language, "LSP server unavailable");
                    StatusKind::Unavailable
                }
            };
            reject_response(status)
        }
    }
}

/// The bare status response that refuses an LSP upgrade.
fn reject_response(kind: StatusKind) -> Response {
    crate::respond::status_code(kind).into_response()
}

/// Relays frames both ways until either side ends. Dropping the client
/// detaches it and re-arms the server's idle reaper.
async fn pump_lsp_socket(mut socket: WebSocket, mut client: LspClient) {
    loop {
        tokio::select! {
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Text(text))) => client.forward(text.to_string()).await,
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
            event = client.recv() => match event {
                Some(ClientEvent::Message(payload)) => {
                    if socket.send(Message::Text(payload.into())).await.is_err() {
                        break;
                    }
                }
                Some(ClientEvent::Close { code, reason }) => {
                    let frame = CloseFrame { code, reason: reason.into() };
                    if let Err(error) = socket.send(Message::Close(Some(frame))).await {
                        tracing::warn!(%error, "failed to send LSP WebSocket close frame");
                    }
                    break;
                }
                None => break,
            },
        }
    }
}
