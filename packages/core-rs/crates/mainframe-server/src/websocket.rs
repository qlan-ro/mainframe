//! The `/ws` WebSocket layer, with the `ws_file_watch` wiring and the
//! `ws_schemas` validation seam.
//!
//! Upgrade auth (token query param unless loopback), `connection.ready` first
//! frame, per-connection chat subscriptions (`subscribe`/`unsubscribe` +
//! `subscribe:ack` — the reply carries `worktree.offer.snapshot` then the
//! ack), per-connection file subscriptions wired to the `FileWatcherService`,
//! and the broadcast fan-out with chatId-scoped vs connection-global gating.
//!
//! Each connection is a single task that `select!`s over `socket.recv()` and its
//! own outbound mpsc (the write task folded in). A separate write task would
//! need the axum `WebSocket` split into Sink/Stream halves, which needs
//! `futures_util::StreamExt`, and that is outside the workspace allowlist.
//! Delivery fans out through the `Arc<DashMap<ClientId, ClientHandle>>`
//! registry and each connection's mpsc sink.

use mainframe_types::sync::LockExt as _;
use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use dashmap::DashMap;
use mainframe_types::events::{ClientEvent, DaemonEvent};
use serde::Deserialize;
use tokio::sync::{broadcast, mpsc};

use crate::ctx::AppCtx;
use crate::middleware::auth::validate_device_token;
use crate::net::{is_localhost, trust_proxy_client_ip};
use crate::ws_file_watch::{WsFileWatch, resolve_subscribe_base, validate_relative};
use crate::ws_schemas::parse_client_event;

/// Per-connection registry entry. Holds the outbound sink and the shared chat
/// subscription set (read by the fan-out, written by the connection task).
pub struct ClientHandle {
    tx: mpsc::UnboundedSender<String>,
    subscriptions: Arc<Mutex<HashSet<String>>>,
}

/// `Arc<DashMap<ClientId, ClientHandle>>` — the shared live-client registry.
pub type WsClients = Arc<DashMap<String, ClientHandle>>;

/// `?token=` on the upgrade URL.
#[derive(Debug, Deserialize)]
pub(crate) struct WsQuery {
    token: Option<String>,
}

/// Mirrors `isWsAuthRequired(ip, secret)`: auth is required only when a secret is
/// configured AND the (derived) client IP is non-loopback.
pub fn is_ws_auth_required(ip: &str, secret: Option<&str>) -> bool {
    match secret {
        None => false,
        Some(_) => !is_localhost(ip),
    }
}

/// Shared upgrade-auth check for every self-authenticating WS route (`/`,
/// `/lsp/:projectId/:language`, `/acp/:profile`): a token query param unless
/// the peer is loopback. Extracted once a third route needed the identical
/// block (repo rule: extract shared helpers at 3+ duplications).
pub(crate) async fn authenticate_ws_upgrade(
    ctx: &AppCtx,
    peer: &SocketAddr,
    headers: &HeaderMap,
    token: Option<String>,
) -> bool {
    let forwarded = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok());
    let ip = trust_proxy_client_ip(&peer.ip().to_string(), forwarded);
    let secret = ctx.core.auth_secret.clone();

    if !is_ws_auth_required(&ip, secret.as_deref()) {
        return true;
    }
    let authed = match (token, secret) {
        (Some(token), Some(secret)) => validate_device_token(&ctx.core.db, secret, token)
            .await
            .is_some(),
        _ => false,
    };
    if !authed {
        tracing::warn!(ip, "ws upgrade rejected: invalid or missing token");
    }
    authed
}

/// The `/` WS route handler: authenticates the upgrade (token query param unless
/// loopback), then upgrades. Mirrors `setupUpgradeAuth` + the `connection` setup.
pub(crate) async fn ws_handler(
    State(ctx): State<Arc<AppCtx>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(query): Query<WsQuery>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !authenticate_ws_upgrade(&ctx, &peer, &headers, query.token).await {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    // LSP upgrades (`/lsp/:projectId/:language`) are a separate axum route
    // (`lsp_ws_handler`); this handler only serves the generic client WS at `/`.
    let ctx = Arc::clone(&ctx);
    upgrade.on_upgrade(move |socket| handle_socket(socket, ctx))
}

async fn handle_socket(mut socket: WebSocket, ctx: Arc<AppCtx>) {
    let client_id = nanoid::nanoid!();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
    let subscriptions: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
    ctx.infra.ws_clients.insert(
        client_id.clone(),
        ClientHandle {
            tx: out_tx.clone(),
            subscriptions: Arc::clone(&subscriptions),
        },
    );

    // First frame: connection.ready with the stable per-connection id.
    send(
        &out_tx,
        &DaemonEvent::ConnectionReady {
            client_id: client_id.clone(),
        },
    );
    // Replay each probed adapter's model catalog so a fresh connection's store is
    // authoritative (the renderer resets on connect). The live probe broadcast
    // fires once at boot, before any client connects, so a reconnecting client
    // would otherwise never learn the catalog. Mirrors buildConnectReplayEvents.
    for event in build_connect_replay_events(&ctx.core.adapter_registry.get_snapshots()) {
        send(&out_tx, &event);
    }

    // File-watch state is touched only by this task (inbound handling + close),
    // so it stays task-local — no lock needed (single owner).
    let mut file_watch = WsFileWatch::default();

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        handle_text(text.as_str(), &ctx, &out_tx, &subscriptions, &mut file_watch).await;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {} // binary / ping / pong — ignored (axum auto-pongs)
                    Some(Err(_)) => break,
                }
            }
            outbound = out_rx.recv() => {
                match outbound {
                    Some(payload) => {
                        if socket.send(Message::Text(payload.into())).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
        }
    }

    ctx.infra.ws_clients.remove(&client_id);
    file_watch.unsubscribe_all(&ctx.services.watcher);
}

async fn handle_text(
    text: &str,
    ctx: &Arc<AppCtx>,
    out_tx: &mpsc::UnboundedSender<String>,
    subscriptions: &Arc<Mutex<HashSet<String>>>,
    file_watch: &mut WsFileWatch,
) {
    match parse_client_event(text) {
        Ok(event) => handle_client_event(event, ctx, out_tx, subscriptions, file_watch).await,
        Err(err) => send(
            out_tx,
            &DaemonEvent::Error {
                chat_id: None,
                error: err.to_string(),
            },
        ),
    }
}

async fn handle_client_event(
    event: ClientEvent,
    ctx: &Arc<AppCtx>,
    out_tx: &mpsc::UnboundedSender<String>,
    subscriptions: &Arc<Mutex<HashSet<String>>>,
    file_watch: &mut WsFileWatch,
) {
    match event {
        ClientEvent::Subscribe { chat_id } => {
            subscriptions.lock_recover().insert(chat_id.clone());
            // Sent even when empty: this snapshot is the client's only re-seed
            // path for offers, so a reconnect must also clear stale ones.
            let offers = ctx.chat.chat_manager.worktree_offers_for_chat(&chat_id);
            send(
                out_tx,
                &DaemonEvent::WorktreeOfferSnapshot {
                    chat_id: chat_id.clone(),
                    offers,
                },
            );
            send(out_tx, &DaemonEvent::SubscribeAck { chat_id });
        }
        ClientEvent::Unsubscribe { chat_id } => {
            subscriptions.lock_recover().remove(&chat_id);
        }
        ClientEvent::SubscribeFile {
            path,
            project_id,
            chat_id,
        } => {
            handle_subscribe_file(ctx, out_tx, file_watch, path, project_id, chat_id).await;
        }
        ClientEvent::UnsubscribeFile {
            path,
            project_id,
            chat_id,
        } => {
            file_watch.unsubscribe(
                &path,
                &ctx.services.watcher,
                project_id.as_deref(),
                chat_id.as_deref(),
            );
        }
    }
}

async fn handle_subscribe_file(
    ctx: &Arc<AppCtx>,
    out_tx: &mpsc::UnboundedSender<String>,
    file_watch: &mut WsFileWatch,
    path: String,
    project_id: Option<String>,
    chat_id: Option<String>,
) {
    // Resolve the containment base (mirrors resolveSubscribePath). Absolute paths
    // pass through untouched; relative paths need a projectId and a db lookup.
    let base = if path.starts_with('/') {
        Some(path.clone())
    } else if let Some(project_id) = project_id.clone() {
        resolve_subscribe_base(ctx, &project_id, chat_id.as_deref()).await
    } else {
        tracing::warn!(
            path,
            "subscribe:file rejected: relative path requires projectId"
        );
        None
    };
    let Some(base) = base else { return };

    // Absolute paths are trusted as-is (no containment check); relative paths
    // must validate inside the base.
    let absolute = if path.starts_with('/') {
        base
    } else {
        match validate_relative(&base, &path).await {
            Some(resolved) => resolved,
            None => {
                tracing::warn!(
                    path,
                    base,
                    "subscribe:file rejected: path escapes project base"
                );
                return;
            }
        }
    };

    if let Some((requested_path, resolved_path)) = file_watch
        .subscribe(
            &path,
            &absolute,
            &ctx.services.watcher,
            project_id.as_deref(),
            chat_id.as_deref(),
        )
        .await
    {
        send(
            out_tx,
            &DaemonEvent::SubscribeFileAck {
                requested_path,
                resolved_path,
            },
        );
    }
}

/// Spawn the single broadcast fan-out task: drains the daemon event stream and
/// delivers each event to the subscribed clients per the scoping rules. Mirrors
/// `broadcastEvent`. Call once, after the runtime is up.
pub fn spawn_broadcast_pump(ctx: Arc<AppCtx>) {
    let mut rx = ctx.core.broadcast.subscribe();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => fanout(&ctx.infra.ws_clients, &event),
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!(dropped = n, "ws broadcast lagged");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

/// Deliver `event` to every client whose subscription set admits it. Events
/// carrying a `chatId` reach only subscribers of that chat, EXCEPT the
/// connection-global types; events without a `chatId` reach everyone.
fn fanout(clients: &WsClients, event: &DaemonEvent) {
    let payload = match serde_json::to_string(event) {
        Ok(payload) => payload,
        Err(err) => {
            tracing::error!(error = %err, "failed to serialize broadcast event");
            return;
        }
    };
    let chat_id = event.chat_id();
    let is_global = event.is_connection_global();

    for entry in clients.iter() {
        let handle = entry.value();
        let deliver = is_global
            || match chat_id {
                None => true,
                Some(chat) => handle.subscriptions.lock_recover().contains(chat),
            };
        if deliver {
            let _ = handle.tx.send(payload.clone());
        }
    }
}

/// Events replayed to a client the moment it connects. Only probed catalogs
/// carry a live model list worth replaying; a fallback/unprobed adapter is
/// skipped unless it carries a fork signal (see below).
fn build_connect_replay_events(
    snapshots: &[mainframe_types::adapter::AdapterInfo],
) -> Vec<DaemonEvent> {
    use mainframe_types::adapter::CatalogSource;
    snapshots
        .iter()
        .filter_map(|s| {
            // A version-gated capability (Codex's `fork`) or its
            // unavailable-reason is worth replaying even for an adapter whose
            // catalog never made it past the fallback seed, not only when the
            // catalog was probed.
            let probed = matches!(s.catalog_source, Some(CatalogSource::Probed));
            let has_fork_signal = s.capabilities.fork || s.fork_unavailable_reason.is_some();
            if !probed && !has_fork_signal {
                return None;
            }
            let models_revision = s.models_revision?;
            Some(DaemonEvent::AdapterModelsUpdated {
                adapter_id: s.id.clone(),
                models: s.models.clone(),
                models_revision,
                installed: Some(s.installed),
                capabilities: Some(s.capabilities),
                fork_unavailable_reason: s.fork_unavailable_reason.clone(),
            })
        })
        .collect()
}

fn send(out_tx: &mpsc::UnboundedSender<String>, event: &DaemonEvent) {
    match serde_json::to_string(event) {
        Ok(payload) => {
            let _ = out_tx.send(payload);
        }
        Err(err) => tracing::error!(error = %err, "failed to serialize outbound ws event"),
    }
}

#[cfg(test)]
#[path = "websocket_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "websocket/filter_tests.rs"]
mod filter_tests;
