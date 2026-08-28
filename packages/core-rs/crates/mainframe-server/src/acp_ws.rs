//! `/acp/{adapter-profile}` — the ACP v2 chat-facade WS upgrade (todo #350).
//! Self-authenticates like `/` and `/lsp/:projectId/:language`; the profile
//! segment must name a registered adapter. This module is only the axum
//! socket shell: inbound frames route through `dispatch::handle_inbound`
//! (prompt/cancel/resume/gate answers over the live `ChatManager`), outbound
//! frames arrive from the `FacadeHub` — the `ChatSurface` observer attached
//! at boot — via the per-connection channel, and two tickers drive the
//! heartbeat and the throttle flush.

mod dispatch;
mod facade_conn;
mod hub;
mod ports;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use mainframe_acp::{DaemonInfo, heartbeat_notification};
use serde::Deserialize;

pub use hub::{FACADE_THROTTLE_INTERVAL_MS, FacadeHub};

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

    let ctx = Arc::clone(&ctx);
    upgrade.on_upgrade(move |socket| handle_acp_socket(socket, ctx, profile))
}

/// Drive one accepted facade connection: register it on the hub, then
/// `select!` between inbound frames, hub-pushed outbound frames, the
/// heartbeat ticker, and the throttle flush tick until either side closes.
async fn handle_acp_socket(mut socket: WebSocket, ctx: Arc<AppCtx>, profile: String) {
    let (client_id, connection, mut outbound) = ctx.facade_hub.register(profile);

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
    let mut flush = tokio::time::interval(Duration::from_millis(
        FACADE_THROTTLE_INTERVAL_MS.max(1) as u64,
    ));
    flush.tick().await;
    let mut sequence: u64 = 0;

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        let reply =
                            dispatch::handle_inbound(text.as_str(), &daemon, &ctx, &connection)
                                .await;
                        // Written before the next outbound drain, so a reply
                        // can never trail frames its own request caused.
                        if let Some(reply) = reply
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
            frame = outbound.recv() => {
                match frame {
                    Some(payload) => {
                        if socket.send(Message::Text(payload.into())).await.is_err() {
                            break;
                        }
                    }
                    None => break,
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
            _ = flush.tick() => {
                ctx.facade_hub.flush_connection(&connection);
            }
        }
    }

    ctx.facade_hub.unregister(&client_id);
}
