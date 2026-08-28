//! `/acp/{adapter-profile}` — the ACP v2 chat-facade WS upgrade (todo #350,
//! plan task 8). Self-authenticates like `/` and `/lsp/:projectId/
//! :language`; the profile segment must name a registered adapter. Frame
//! handling delegates to the pure `mainframe_acp::connection::handle_frame`
//! state machine — this module is the axum socket shell. The heartbeat
//! ticker and the facade connection registry are task 9.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use mainframe_acp::{DaemonInfo, handle_frame};
use serde::Deserialize;

use crate::ctx::AppCtx;
use crate::websocket::authenticate_ws_upgrade;

/// `?token=` on the upgrade URL, matching the other self-authenticating WS
/// routes.
#[derive(Debug, Deserialize)]
pub(crate) struct AcpWsQuery {
    token: Option<String>,
}

pub(crate) async fn acp_ws_handler(
    State(ctx): State<Arc<AppCtx>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Path(profile): Path<String>,
    Query(query): Query<AcpWsQuery>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !authenticate_ws_upgrade(&ctx, &peer, &headers, query.token).await {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }
    // Checked after auth so an unauthenticated caller cannot probe which
    // adapter ids are registered.
    if ctx.adapter_registry.get(&profile).is_none() {
        return (StatusCode::NOT_FOUND, "Unknown adapter profile").into_response();
    }

    // `profile` is reserved for task 9's per-connection registry entry.
    let _ = profile;
    let ctx = Arc::clone(&ctx);
    upgrade.on_upgrade(move |socket| handle_acp_socket(socket, ctx))
}

/// Drive one accepted facade connection: dispatch each inbound frame through
/// `handle_frame` until either side closes.
async fn handle_acp_socket(mut socket: WebSocket, ctx: Arc<AppCtx>) {
    let daemon = DaemonInfo {
        version: ctx.version.clone(),
        heartbeat_interval_ms: mainframe_acp::DEFAULT_HEARTBEAT_INTERVAL_MS,
    };

    loop {
        match socket.recv().await {
            Some(Ok(Message::Text(text))) => {
                if let Some(reply) = handle_frame(text.as_str(), &daemon)
                    && socket.send(Message::Text(reply.into())).await.is_err()
                {
                    break;
                }
            }
            Some(Ok(Message::Close(_))) | None => break,
            Some(Ok(_)) => {} // binary / ping / pong — ignored (axum auto-pongs)
            Some(Err(_)) => break,
        }
    }
}
