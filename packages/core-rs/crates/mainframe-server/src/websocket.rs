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
        let chat_id = chat_id.clone();
        ctx.core
            .db
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
            tracing::error!(%err, "failed to serialize broadcast event");
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
        Err(err) => tracing::error!(%err, "failed to serialize outbound ws event"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mainframe_types::adapter::{
        AdapterCapabilities, AdapterInfo, CatalogSource, ProviderQuota, ProviderQuotaStatus,
        QuotaWindow, QuotaWindowKind,
    };

    fn fallback_snapshot(id: &str, capabilities: AdapterCapabilities) -> AdapterInfo {
        AdapterInfo {
            id: id.to_string(),
            name: id.to_string(),
            description: format!("{id} adapter"),
            installed: true,
            version: None,
            models: vec![],
            models_revision: Some(1),
            catalog_source: Some(CatalogSource::Fallback),
            capabilities,
            fork_unavailable_reason: None,
        }
    }

    fn register_client(
        clients: &WsClients,
        id: &str,
        chats: &[&str],
    ) -> mpsc::UnboundedReceiver<String> {
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
                    observed_at: None,
                    label: None,
                }),
                weekly: None,
                account_identity: Some("uuid-1".into()),
            },
        }
    }

    // An adapter whose catalog never left the fallback seed (so a
    // `catalog_source == Probed` gate alone would skip it) still needs its
    // capabilities replayed to a reconnecting client once `fork` is true.
    #[test]
    fn replays_fork_capability_for_a_fallback_catalog_adapter() {
        let caps = AdapterCapabilities {
            plan_mode: false,
            auto_mode: false,
            no_persistence: false,
            fork: true,
        };
        let snapshots = vec![fallback_snapshot("codex", caps)];
        let events = build_connect_replay_events(&snapshots);
        assert_eq!(
            events,
            vec![DaemonEvent::AdapterModelsUpdated {
                adapter_id: "codex".into(),
                models: vec![],
                models_revision: 1,
                installed: Some(true),
                capabilities: Some(caps),
                fork_unavailable_reason: None,
            }]
        );
    }

    // A fallback-catalog adapter with no fork signal (the common case) still
    // produces no replay.
    #[test]
    fn skips_replay_for_a_fallback_catalog_adapter_with_no_fork_signal() {
        let caps = AdapterCapabilities {
            plan_mode: true,
            auto_mode: false,
            no_persistence: false,
            fork: false,
        };
        let snapshots = vec![fallback_snapshot("claude", caps)];
        assert!(build_connect_replay_events(&snapshots).is_empty());
    }

    // A fallback-catalog adapter with a known fork-unavailable reason (e.g. an
    // old Codex CLI) also replays, so the UI's disabled-Fork reason
    // survives a reconnect even before the catalog probe ever succeeds.
    #[test]
    fn replays_fork_unavailable_reason_for_a_fallback_catalog_adapter() {
        let caps = AdapterCapabilities {
            plan_mode: false,
            auto_mode: false,
            no_persistence: false,
            fork: false,
        };
        let mut snapshot = fallback_snapshot("codex", caps);
        snapshot.fork_unavailable_reason = Some("Codex CLI too old".into());
        let events = build_connect_replay_events(&[snapshot]);
        assert_eq!(events.len(), 1);
        match &events[0] {
            DaemonEvent::AdapterModelsUpdated {
                fork_unavailable_reason,
                ..
            } => {
                assert_eq!(
                    fork_unavailable_reason.as_deref(),
                    Some("Codex CLI too old")
                );
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    // Seam-3 transport: a harvested quota carries no chatId, so the fan-out must
    // reach every client account-wide — even one subscribed to no chat.
    #[test]
    fn delivers_provider_quota_updated_to_a_client_subscribed_to_no_chat() {
        let clients: WsClients = Arc::new(DashMap::new());
        let mut rx = register_client(&clients, "client-1", &[]);

        fanout(&clients, &quota_event());

        let payload = rx
            .try_recv()
            .expect("no-subscription client received the event");
        let value: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(value["type"], serde_json::json!("provider.quota.updated"));
        assert_eq!(value["adapterId"], serde_json::json!("claude"));
        assert_eq!(
            value["quota"]["session"]["usedPercent"],
            serde_json::json!(55.0)
        );
    }

    // `chat.offloaded` carries a `chatId` but must still reach a client
    // that never subscribed to that chat — the renderer needs to drop the
    // controller for a chat it isn't currently displaying.
    #[test]
    fn delivers_chat_offloaded_to_a_client_subscribed_to_no_chat() {
        let clients: WsClients = Arc::new(DashMap::new());
        let mut rx = register_client(&clients, "client-1", &[]);

        fanout(
            &clients,
            &DaemonEvent::ChatOffloaded {
                chat_id: "chat_1".to_string(),
            },
        );

        let payload = rx
            .try_recv()
            .expect("no-subscription client received chat.offloaded");
        let value: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(value["type"], serde_json::json!("chat.offloaded"));
        assert_eq!(value["chatId"], serde_json::json!("chat_1"));
    }

    /// A first-hop rule would trust a FORGED leftmost `x-forwarded-for` hop, so
    /// a client could claim loopback (and skip auth entirely) by prepending
    /// `127.0.0.1` ahead of its real address.
    /// `trust_proxy_client_ip` walks the chain from the right instead, so the
    /// real appended hop wins and a token is required.
    #[tokio::test]
    async fn a_forged_leftmost_forwarded_for_cannot_claim_loopback() {
        let mut ctx = Arc::try_unwrap(AppCtx::test_ctx()).unwrap_or_else(|_| unreachable!());
        ctx.core.auth_secret = Some("secret".to_string());
        let ctx = Arc::new(ctx);

        let peer: SocketAddr = "127.0.0.1:9999".parse().unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "127.0.0.1, 203.0.113.7".parse().unwrap());

        let authed = authenticate_ws_upgrade(&ctx, &peer, &headers, None).await;
        assert!(
            !authed,
            "a forged leftmost 127.0.0.1 must not exempt the real client from auth"
        );
    }
}

#[cfg(test)]
#[path = "websocket/filter_tests.rs"]
mod filter_tests;
