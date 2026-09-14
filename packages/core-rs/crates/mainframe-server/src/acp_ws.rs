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
use facade_conn::FacadeConnection;

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

/// A periodic tick with its first (immediate) firing already consumed, so
/// the caller's loop sees one tick per configured cadence, not an extra one
/// at connect time — `connection.ready`'s WS twin already marks connect.
async fn periodic(interval_ms: u64) -> tokio::time::Interval {
    let mut ticker = tokio::time::interval(Duration::from_millis(interval_ms.max(1)));
    ticker.tick().await;
    ticker
}

/// One inbound WS message. Returns whether the socket loop should break.
async fn handle_incoming(
    incoming: Option<Result<Message, axum::Error>>,
    daemon: &DaemonInfo,
    ctx: &Arc<AppCtx>,
    connection: &Arc<FacadeConnection>,
    socket: &mut WebSocket,
) -> bool {
    match incoming {
        Some(Ok(Message::Text(text))) => {
            let reply = dispatch::handle_inbound(text.as_str(), daemon, ctx, connection).await;
            // Written before the next outbound drain, so a reply can never
            // trail frames its own request caused.
            match reply {
                Some(reply) => socket.send(Message::Text(reply.into())).await.is_err(),
                None => false,
            }
        }
        Some(Ok(Message::Close(_))) | None => true,
        Some(Ok(_)) => false, // binary / ping / pong — ignored (axum auto-pongs)
        Some(Err(_)) => true,
    }
}

/// One hub-pushed outbound frame. Returns whether the socket loop should
/// break.
async fn handle_outbound(frame: Option<String>, socket: &mut WebSocket) -> bool {
    match frame {
        Some(payload) => socket.send(Message::Text(payload.into())).await.is_err(),
        None => true,
    }
}

/// One heartbeat tick. Returns whether the socket loop should break.
async fn handle_heartbeat_tick(sequence: u64, socket: &mut WebSocket) -> bool {
    let note = heartbeat_notification(sequence);
    let Ok(payload) = serde_json::to_string(&note) else {
        return false;
    };
    socket.send(Message::Text(payload.into())).await.is_err()
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
    let mut heartbeat = periodic(ctx.facade_heartbeat_interval_ms).await;
    let mut flush = periodic(FACADE_THROTTLE_INTERVAL_MS as u64).await;
    let mut sequence: u64 = 0;

    loop {
        let should_break = tokio::select! {
            incoming = socket.recv() => {
                handle_incoming(incoming, &daemon, &ctx, &connection, &mut socket).await
            }
            frame = outbound.recv() => handle_outbound(frame, &mut socket).await,
            _ = heartbeat.tick() => {
                sequence += 1;
                handle_heartbeat_tick(sequence, &mut socket).await
            }
            _ = flush.tick() => {
                ctx.facade_hub.flush_connection(&connection);
                false
            }
        };
        if should_break {
            break;
        }
    }

    ctx.facade_hub.unregister(&client_id);
}
