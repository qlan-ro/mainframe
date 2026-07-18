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
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, Once, PoisonError};

use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use dashmap::DashMap;
use mainframe_chat::chat_manager::CommandMeta;
use mainframe_lsp::lsp_connection::attach_client_with_capture;
use mainframe_lsp::{
    ChatStore, ClientRef, LspConnectionHandler, LspServerHandle, ProjectStore, ReattachAction,
    UpgradeOutcome, bridge_ws_to_process, cached_initialize_reply, classify_reattach_first,
};
use mainframe_types::chat::{Chat, Project};
use mainframe_types::events::{ClientEvent, DaemonEvent};
use serde::Deserialize;
use tokio::sync::{broadcast, mpsc};

use crate::ctx::AppCtx;
use crate::db::Db;
use crate::middleware::auth::validate_device_token;
use crate::net::{client_ip, is_localhost};
use crate::ws_file_watch::{WsFileWatch, resolve_subscribe_base, validate_relative};
use crate::ws_schemas::parse_client_event;

/// Event types delivered to every connected client regardless of per-chat
/// subscription (unread-dot / attention-badge for backgrounded chats). Verbatim
/// from `CONNECTION_GLOBAL_EVENT_TYPES` + `automation.notification` (T9.1 —
/// chatId-less, fans out to all clients).
const CONNECTION_GLOBAL_EVENT_TYPES: [&str; 3] = [
    "chat.notification",
    "permission.requested",
    "automation.notification",
];

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

    // LSP upgrades (`/lsp/:projectId/:language`) are a separate axum route
    // (`lsp_ws_handler`); this handler only serves the generic client WS at `/`.
    let ctx = Arc::clone(&ctx);
    upgrade.on_upgrade(move |socket| handle_socket(socket, ctx))
}

/// `?token=`/`?chatId=` on the LSP upgrade URL.
#[derive(Debug, Deserialize)]
pub(crate) struct LspWsQuery {
    token: Option<String>,
    #[serde(rename = "chatId")]
    chat_id: Option<String>,
}

/// Read-only `ProjectStore` over the DB actor (parity with `db.projects.get`).
struct DbProjectStore {
    db: Db,
}

impl ProjectStore for DbProjectStore {
    fn get_project(&self, project_id: &str) -> Option<Project> {
        let id = project_id.to_string();
        self.db
            .call_blocking(move |d| d.projects.get(&id))
            .ok()
            .flatten()
    }
}

/// Read-only `ChatStore` over the DB actor (parity with `chats.getChat`).
struct DbChatStore {
    db: Db,
}

impl ChatStore for DbChatStore {
    fn get_chat(&self, chat_id: &str) -> Option<Chat> {
        let id = chat_id.to_string();
        self.db
            .call_blocking(move |d| d.chats.get(&id))
            .ok()
            .flatten()
    }
}

/// The `/lsp/:projectId/:language` WS route handler. Self-authenticates (token
/// query param unless loopback), validates + spawns the language server via the
/// `LspConnectionHandler`, then bridges the accepted socket to the child process.
/// Mirrors the `server.on('upgrade')` LSP branch in `websocket.ts`.
pub(crate) async fn lsp_ws_handler(
    State(ctx): State<Arc<AppCtx>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Path((project_id, language)): Path<(String, String)>,
    Query(query): Query<LspWsQuery>,
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

    let Some(manager) = ctx.lsp_manager.clone() else {
        // No LSP manager wired — the `/lsp/...` route has nothing to serve.
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    };

    let handler = LspConnectionHandler::with_chats(
        Arc::clone(&manager),
        Arc::new(DbProjectStore { db: ctx.db.clone() }),
        Arc::new(DbChatStore { db: ctx.db.clone() }),
    );
    match handler
        .handle_upgrade(&project_id, &language, query.chat_id.as_deref())
        .await
    {
        UpgradeOutcome::Reject(status_line) => reject_response(status_line),
        UpgradeOutcome::Proceed(handle) => {
            let manager = Arc::clone(&manager);
            upgrade.on_upgrade(move |socket| {
                drive_lsp_socket(socket, handle, manager, project_id, language)
            })
        }
    }
}

/// Map the raw HTTP status line the LSP handler returns onto an axum response.
fn reject_response(status_line: &str) -> Response {
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .and_then(|code| StatusCode::from_u16(code).ok())
        .unwrap_or(StatusCode::BAD_GATEWAY);
    status.into_response()
}

/// Bridge an accepted LSP WebSocket to its spawned language-server child, mirroring
/// `onConnection` in `lsp-connection.ts`: cancel the idle reaper, attach the client
/// (first-connect capture vs reconnect replay), relay frames both ways, and on
/// disconnect detach + restart the idle timer.
async fn drive_lsp_socket(
    mut socket: WebSocket,
    handle: Arc<LspServerHandle>,
    manager: Arc<mainframe_lsp::LspManager>,
    project_id: String,
    language: String,
) {
    let reattach = handle.has_initialize_result();
    tracing::info!(
        project_id,
        language,
        reattach,
        "LSP WebSocket client connected"
    );
    manager.cancel_idle_timer(&handle);

    // Client → process (incoming) and process → client (outgoing) channels, plus a
    // ClientRef the manager can close (server exit / replacement).
    let (incoming_tx, incoming_rx) = mpsc::unbounded_channel::<String>();
    let (outgoing_tx, mut outgoing_rx) = mpsc::unbounded_channel::<String>();
    let open = Arc::new(AtomicBool::new(true));
    let (close_tx, mut close_rx) = mpsc::unbounded_channel::<(u16, String)>();
    handle.set_client(Some(ClientRef::new(Arc::clone(&open), close_tx)));

    // First-connect: bridge immediately with init-result capture. Reconnect: defer
    // the bridge until the client's init handshake replays from cache.
    let mut incoming_rx = Some(incoming_rx);
    let mut bridge_started = false;
    if !reattach && let Some(rx) = incoming_rx.take() {
        attach_client_with_capture(&handle, rx, outgoing_tx.clone());
        bridge_started = true;
    }

    let key = format!("{project_id}:{language}");
    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        let text = text.to_string();
                        if reattach && !bridge_started {
                            match classify_reattach_first(&text) {
                                ReattachAction::ReplayInitialize { id } => {
                                    if let Some(result) = handle.initialize_result() {
                                        tracing::info!(project_id, language, "Replaying cached initialize result for reconnecting client");
                                        let _ = outgoing_tx.send(cached_initialize_reply(&id, &result));
                                    }
                                }
                                ReattachAction::SkipInitialized => {
                                    bridge_started = start_reattach_bridge(&handle, &mut incoming_rx, &outgoing_tx);
                                }
                                ReattachAction::Forward => {
                                    bridge_started = start_reattach_bridge(&handle, &mut incoming_rx, &outgoing_tx);
                                    if bridge_started {
                                        let _ = incoming_tx.send(text);
                                    }
                                }
                            }
                        } else {
                            let _ = incoming_tx.send(text);
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            outbound = outgoing_rx.recv() => {
                match outbound {
                    Some(payload) => {
                        if socket.send(Message::Text(payload.into())).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
            closed = close_rx.recv() => {
                if let Some((code, reason)) = closed {
                    let _ = socket
                        .send(Message::Close(Some(CloseFrame { code, reason: reason.into() })))
                        .await;
                }
                break;
            }
        }
    }

    // Disconnect: detach the client + restart the idle reaper (onConnection close).
    tracing::info!(project_id, language, "LSP WebSocket client disconnected");
    open.store(false, std::sync::atomic::Ordering::SeqCst);
    handle.set_cleanup(None);
    handle.set_client(None);
    manager.start_idle_timer(&key, &handle);
}

/// Start the plain (no-capture) reattach bridge when the child's stdio is still
/// available. Returns whether the bridge started. The current `mainframe-lsp` seam
/// consumes the child's stdout/stderr on the first attach, so a reconnect after the
/// first bridge was torn down cannot re-proxy — flagged as a known LSP-reattach gap.
fn start_reattach_bridge(
    handle: &Arc<LspServerHandle>,
    incoming_rx: &mut Option<mpsc::UnboundedReceiver<String>>,
    outgoing_tx: &mpsc::UnboundedSender<String>,
) -> bool {
    let (Some(rx), Some(stdout), Some(stderr)) = (
        incoming_rx.take(),
        handle.take_stdout(),
        handle.take_stderr(),
    ) else {
        tracing::warn!(
            "LSP reattach: child stdio unavailable (consumed by prior bridge) — cannot re-proxy"
        );
        return false;
    };
    let bridge = bridge_ws_to_process(rx, outgoing_tx.clone(), handle.stdin_tx(), stdout, stderr);
    handle.set_cleanup(Some(bridge));
    true
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
    // Replay each probed adapter's model catalog so a fresh connection's store is
    // authoritative (the renderer resets on connect). The live probe broadcast
    // fires once at boot, before any client connects, so a reconnecting client
    // would otherwise never learn the catalog. Mirrors buildConnectReplayEvents.
    for event in build_connect_replay_events(&ctx.adapter_registry.get_snapshots()) {
        send(&out_tx, &event);
    }

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

/// Events replayed to a client the moment it connects (ported from
/// `adapter-replay.ts`). Only probed catalogs carry a live model list worth
/// replaying; a fallback/unprobed adapter is skipped.
fn build_connect_replay_events(
    snapshots: &[mainframe_types::adapter::AdapterInfo],
) -> Vec<DaemonEvent> {
    use mainframe_types::adapter::CatalogSource;
    snapshots
        .iter()
        .filter_map(|s| match (s.catalog_source, s.models_revision) {
            (Some(CatalogSource::Probed), Some(models_revision)) => {
                Some(DaemonEvent::AdapterModelsUpdated {
                    adapter_id: s.id.clone(),
                    models: s.models.clone(),
                    models_revision,
                })
            }
            _ => None,
        })
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::adapter::{ProviderQuota, ProviderQuotaStatus, QuotaWindow, QuotaWindowKind};

    fn register_client(clients: &WsClients, id: &str, chats: &[&str]) -> mpsc::UnboundedReceiver<String> {
        let (tx, rx) = mpsc::unbounded_channel::<String>();
        let subscriptions: Arc<Mutex<HashSet<String>>> =
            Arc::new(Mutex::new(chats.iter().map(|c| c.to_string()).collect()));
        clients.insert(id.to_string(), ClientHandle { tx, subscriptions });
        rx
    }

    fn quota_event() -> DaemonEvent {
        DaemonEvent::ProviderQuotaUpdated {
            adapter_id: "claude".into(),
            quota: ProviderQuota {
                status: ProviderQuotaStatus::Ok,
                observed_at: 1_700_000_000_000,
                model_windows: vec![],
                session: Some(QuotaWindow {
                    kind: QuotaWindowKind::Session,
                    used_percent: 55.0,
                    resets_at: Some(1_700_010_000_000),
                    label: None,
                }),
                weekly: None,
                account_identity: Some("uuid-1".into()),
            },
        }
    }

    // Seam-3 transport: a harvested quota carries no chatId, so the fan-out must
    // reach every client account-wide — even one subscribed to no chat.
    #[test]
    fn delivers_provider_quota_updated_to_a_client_subscribed_to_no_chat() {
        let clients: WsClients = Arc::new(DashMap::new());
        let mut rx = register_client(&clients, "client-1", &[]);

        fanout(&clients, &quota_event());

        let payload = rx.try_recv().expect("no-subscription client received the event");
        let value: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(value["type"], serde_json::json!("provider.quota.updated"));
        assert_eq!(value["adapterId"], serde_json::json!("claude"));
        assert_eq!(value["quota"]["session"]["usedPercent"], serde_json::json!(55.0));
    }
}

// PORT STATUS: src/server/websocket.ts (+ ws-file-watch wiring, ws-schemas seam)
// confidence: medium
// todos: 1
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
// sets Some(..) the wired paths run. Adapter-replay (buildConnectReplayEvents over
// the live registry snapshots) streams right after connection.ready so a
// reconnecting client's catalog is authoritative. Task 5.5 added lsp_ws_handler:
// the `/lsp/:projectId/:language` route self-authenticates, validates+spawns via
// LspConnectionHandler (Db-backed ProjectStore/ChatStore), and drives the socket ↔
// child bridge (first-connect capture via attach_client_with_capture; reconnect
// replays the cached initialize + re-bridges). KNOWN GAP: the mainframe-lsp seam
// consumes the child's stdout/stderr on first attach, so a reconnect after the
// first bridge tore down cannot re-proxy (start_reattach_bridge warns) — flagged.
