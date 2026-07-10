//! Ported from `src/server/websocket.ts` (+ `ws-file-watch.ts` wiring and the
//! `ws-schemas.ts` validation seam).
//!
//! Upgrade auth (token query param unless loopback), `connection.ready` first
//! frame, per-connection chat subscriptions (`subscribe`/`unsubscribe` +
//! `subscribe:ack`), per-connection file subscriptions wired to the
//! `FileWatcherService`, and the broadcast fan-out with chatId-scoped vs
//! connection-global gating.
//!
//! **Forced deviation from CONCURRENCY.tsv:** the tsv models each client as a
//! separate *write task* fed by an mpsc, which requires splitting the axum
//! `WebSocket` into Sink/Stream halves — that needs `futures_util::StreamExt`,
//! which is outside the workspace allowlist. So each connection is a single task
//! that `select!`s over `socket.recv()` and its own outbound mpsc (the write
//! task folded in). The `Arc<DashMap<ClientId, ClientHandle>>` registry and the
//! per-connection mpsc sink from the tsv are preserved; delivery still fans out
//! through them.

use std::collections::HashSet;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, Once, PoisonError};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use dashmap::DashMap;
use mainframe_chat::chat_manager::CommandMeta;
use mainframe_types::events::{ClientEvent, DaemonEvent};
use serde::Deserialize;
use tokio::sync::{broadcast, mpsc};

use crate::ctx::AppCtx;
use crate::middleware::auth::validate_device_token;
use crate::net::{client_ip, is_localhost};
use crate::ws_file_watch::{WsFileWatch, resolve_subscribe_base, validate_relative};
use crate::ws_schemas::parse_client_event;

/// Event types delivered to every connected client regardless of per-chat
/// subscription (unread-dot / attention-badge for backgrounded chats). Verbatim
/// from `CONNECTION_GLOBAL_EVENT_TYPES`.
const CONNECTION_GLOBAL_EVENT_TYPES: [&str; 2] = ["chat.notification", "permission.requested"];

/// Per-connection registry entry. Holds the outbound sink and the shared chat
/// subscription set (read by the fan-out, written by the connection task).
pub struct ClientHandle {
    tx: mpsc::UnboundedSender<String>,
    subscriptions: Arc<Mutex<HashSet<String>>>,
}

/// `Arc<DashMap<ClientId, ClientHandle>>` — the tsv's SHARED_MAP `clients`.
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

/// The `/` WS route handler: authenticates the upgrade (token query param unless
/// loopback), then upgrades. Mirrors `setupUpgradeAuth` + the `connection` setup.
pub(crate) async fn ws_handler(
    State(ctx): State<Arc<AppCtx>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(query): Query<WsQuery>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    let forwarded = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok());
    let ip = client_ip(&peer.ip().to_string(), forwarded);
    let secret = ctx.auth_secret.clone();

    if is_ws_auth_required(&ip, secret.as_deref()) {
        let authed = match (query.token, secret) {
            (Some(token), Some(secret)) => validate_device_token(&ctx.db, secret, token)
                .await
                .is_some(),
            _ => false,
        };
        if !authed {
            tracing::warn!(ip, "ws upgrade rejected: invalid or missing token");
            return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
        }
    }

    // TODO(port-phase5): LSP upgrades (`/lsp/{projectId}/{language}`) are handled
    // before the generic WS handler in the TS server. Here they are simply not
    // mounted, so `/lsp/...` rejects cleanly with a 404 until the LSP port lands.
    let ctx = Arc::clone(&ctx);
    upgrade.on_upgrade(move |socket| handle_socket(socket, ctx))
}

/// Drive one accepted connection: register it, send `connection.ready`, then
/// `select!` between inbound frames and the outbound mpsc until either side
/// closes. On close, unregister and drop every file watch.
async fn handle_socket(mut socket: WebSocket, ctx: Arc<AppCtx>) {
    let client_id = nanoid::nanoid!();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
    let subscriptions: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
    ctx.ws_clients.insert(
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
    // TODO(port-phase4): stream adapter-replay events (buildConnectReplayEvents
    // over live adapter snapshots) after connection.ready.

    // File-watch state is touched only by this task (inbound handling + close),
    // so it stays task-local — no lock needed (tsv PER_ENTITY, single-owner).
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

    ctx.ws_clients.remove(&client_id);
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
                error: err.message(),
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
            lock(subscriptions).insert(chat_id.clone());
            // Node emits message.queued.snapshot (refs from getQueuedForChat) BEFORE
            // subscribe:ack (`sendQueuedSnapshot`). With the ChatManager unwired the
            // queue is empty, so this degrades to the empty snapshot the daemon sent
            // before; once `ctx.chat_manager` is Some the real refs flow through.
            let refs = ctx
                .chat_manager
                .as_ref()
                .map(|cm| cm.get_queued_for_chat(&chat_id))
                .unwrap_or_default();
            send(
                out_tx,
                &DaemonEvent::MessageQueuedSnapshot {
                    chat_id: chat_id.clone(),
                    refs,
                },
            );
            send(out_tx, &DaemonEvent::SubscribeAck { chat_id });
        }
        ClientEvent::Unsubscribe { chat_id } => {
            lock(subscriptions).remove(&chat_id);
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
        ClientEvent::MessageSend {
            chat_id,
            content,
            attachment_ids,
            metadata,
        } => {
            handle_message_send(ctx, out_tx, chat_id, content, attachment_ids, metadata).await;
        }
        ClientEvent::PermissionRespond { chat_id, response } => {
            handle_permission_respond(ctx, out_tx, chat_id, response).await;
        }
    }
}

/// `message.send` → `ChatManager.sendMessage(chatId, content, attachmentIds,
/// metadata)`. A rejection lands in the TS `ws.on('message')` catch, which logs
/// `ws message handler error` and replies with an `Internal error` frame — mirror
/// both. Until `ctx.chat_manager` is wired the seam warns once and drops the send.
async fn handle_message_send(
    ctx: &Arc<AppCtx>,
    out_tx: &mpsc::UnboundedSender<String>,
    chat_id: String,
    content: String,
    attachment_ids: Option<Vec<String>>,
    metadata: Option<mainframe_types::events::MessageSendMetadata>,
) {
    let Some(cm) = ctx.chat_manager.as_ref() else {
        warn_message_send_seam();
        return;
    };
    let command = metadata.and_then(|m| m.command).map(|c| CommandMeta {
        name: c.name,
        source: c.source,
        args: c.args,
    });
    if let Err(err) = cm
        .send_message(&chat_id, &content, attachment_ids.as_deref(), command)
        .await
    {
        tracing::error!(%err, "ws message handler error");
        send(
            out_tx,
            &DaemonEvent::Error {
                chat_id: None,
                error: "Internal error".to_string(),
            },
        );
    }
}

/// `permission.respond` → `ChatManager.respondToPermission(chatId, response)`,
/// bracketed by the same received/delivered info logs the TS handler emits. A
/// rejection mirrors the TS catch (`Internal error` frame).
async fn handle_permission_respond(
    ctx: &Arc<AppCtx>,
    out_tx: &mpsc::UnboundedSender<String>,
    chat_id: String,
    response: mainframe_types::adapter::ControlResponse,
) {
    let Some(cm) = ctx.chat_manager.as_ref() else {
        warn_permission_respond_seam();
        return;
    };
    let request_id = response.request_id.clone();
    tracing::info!(
        chat_id,
        request_id = %request_id,
        tool_name = ?response.tool_name,
        behavior = ?response.behavior,
        "permission.respond received from client"
    );
    if let Err(err) = cm.respond_to_permission(&chat_id, response).await {
        tracing::error!(%err, "ws message handler error");
        send(
            out_tx,
            &DaemonEvent::Error {
                chat_id: None,
                error: "Internal error".to_string(),
            },
        );
        return;
    }
    tracing::info!(
        chat_id,
        request_id = %request_id,
        "permission.respond delivered to adapter"
    );
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
        let chat_id = chat_id.clone();
        ctx.db
            .call(move |db| Ok(resolve_subscribe_base(db, &project_id, chat_id.as_deref())))
            .await
            .ok()
            .flatten()
    } else {
        tracing::warn!(
            path,
            "subscribe:file rejected: relative path requires projectId"
        );
        None
    };
    let Some(base) = base else { return };

    // Absolute paths are trusted as-is (no containment check — same as the TS
    // fast-path); relative paths must validate inside the base.
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
    let mut rx = ctx.broadcast.subscribe();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => fanout(&ctx.ws_clients, &event),
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
            tracing::error!(%err, "failed to serialize broadcast event");
            return;
        }
    };
    // A second (structural) serialization purely to read `type`/`chatId` for
    // gating — the wire payload above keeps the struct field order.
    let value = serde_json::to_value(event).unwrap_or(serde_json::Value::Null);
    let type_name = value
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let chat_id = value.get("chatId").and_then(|v| v.as_str());
    let is_global = CONNECTION_GLOBAL_EVENT_TYPES.contains(&type_name);

    for entry in clients.iter() {
        let handle = entry.value();
        let deliver = is_global
            || match chat_id {
                None => true,
                Some(chat) => lock(&handle.subscriptions).contains(chat),
            };
        if deliver {
            let _ = handle.tx.send(payload.clone());
        }
    }
}

fn send(out_tx: &mpsc::UnboundedSender<String>, event: &DaemonEvent) {
    match serde_json::to_string(event) {
        Ok(payload) => {
            let _ = out_tx.send(payload);
        }
        Err(err) => tracing::error!(%err, "failed to serialize outbound ws event"),
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn warn_message_send_seam() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        tracing::warn!("ws message.send received but chat handling is Phase 4 — ignoring");
    });
}

fn warn_permission_respond_seam() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        tracing::warn!("ws permission.respond received but chat handling is Phase 4 — ignoring");
    });
}

// PORT STATUS: src/server/websocket.ts (+ ws-file-watch wiring, ws-schemas seam)
// confidence: medium
// todos: 2
// notes: Single-task-per-connection select! (write task folded in) because
// splitting axum's WebSocket needs futures_util (off-allowlist) — see the header.
// Chat subscriptions = shared Mutex<HashSet> (read by fan-out, tsv PER_ENTITY);
// file-watch state = task-local (single owner). Broadcast fan-out = one pump task
// over broadcast::Receiver → per-client mpsc, with the exact chatId-scoped vs
// connection-global gating. message.send → ChatManager.sendMessage (attachments +
// command meta), permission.respond → respondToPermission, and subscribe's
// message.queued.snapshot (real getQueuedForChat refs) are all WIRED — they
// self-gate on ctx.chat_manager: while it is None (ChatManager construction is a
// documented daemon-boot blocker) they degrade to empty snapshot / warn-once +
// ignore, exactly the pre-4.6b behavior the ws_integration tests pin. Once boot
// sets Some(..) the wired paths run. TODO(port-phase4): adapter-replay after
// connection.ready. TODO(port-phase5): LSP upgrade route.
