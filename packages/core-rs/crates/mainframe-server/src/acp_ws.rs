//! `/acp/{adapter-profile}` — the ACP v2 chat-facade WS upgrade (todo #350,
//! plan tasks 8-9). Self-authenticates like `/` and `/lsp/:projectId/
//! :language`; the profile segment must name a registered adapter. Frame
//! handling delegates to the pure `mainframe_acp::connection::handle_frame`
//! state machine (task 8) — this module is the axum socket shell plus the
//! heartbeat ticker (task 9) and the facade connection registry.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use dashmap::DashMap;
use mainframe_acp::{DaemonInfo, handle_frame, heartbeat_notification};
use serde::Deserialize;

use crate::ctx::AppCtx;
use crate::websocket::authenticate_ws_upgrade;

/// One attached facade connection. `profile` records which adapter the
/// connection negotiated against; group D fills in session-attach state.
pub struct FacadeClientHandle {
    pub profile: String,
}

/// The facade connection registry — parallel to `WsClients` but scoped to
/// `/acp/{profile}` connections.
pub type FacadeClients = Arc<DashMap<String, FacadeClientHandle>>;

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

    let ctx = Arc::clone(&ctx);
    upgrade.on_upgrade(move |socket| handle_acp_socket(socket, ctx, profile))
}

/// Drive one accepted facade connection: register it, then `select!` between
/// inbound frames (dispatched through `handle_frame`) and the heartbeat
/// ticker until either side closes.
async fn handle_acp_socket(mut socket: WebSocket, ctx: Arc<AppCtx>, profile: String) {
    let client_id = nanoid::nanoid!();
    ctx.facade_clients
        .insert(client_id.clone(), FacadeClientHandle { profile });

    let daemon = DaemonInfo {
        version: ctx.version.clone(),
        heartbeat_interval_ms: ctx.facade_heartbeat_interval_ms,
    };
    let mut heartbeat = tokio::time::interval(Duration::from_millis(
        ctx.facade_heartbeat_interval_ms.max(1),
    ));
    // `interval` fires its first tick immediately; consume it so the heartbeat
    // is periodic (one per configured cadence) rather than an extra frame at
    // connect time — `connection.ready`'s WS twin already marks connect.
    heartbeat.tick().await;
    let mut sequence: u64 = 0;

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
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
            _ = heartbeat.tick() => {
                sequence += 1;
                let note = heartbeat_notification(sequence);
                let Ok(payload) = serde_json::to_string(&note) else { continue };
                if socket.send(Message::Text(payload.into())).await.is_err() {
                    break;
                }
            }
        }
    }

    ctx.facade_clients.remove(&client_id);
}
