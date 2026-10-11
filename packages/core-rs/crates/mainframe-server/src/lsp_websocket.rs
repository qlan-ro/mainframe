use crate::{ctx::AppCtx, websocket::authenticate_ws_upgrade};
use axum::{
    extract::{
        ConnectInfo, Path, Query, State,
        ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use mainframe_lsp::{
    ClientRef, LspConnectionHandler, LspServerHandle, ReattachAction, UpgradeOutcome,
    bridge_ws_to_process, cached_initialize_reply, classify_reattach_first,
    lsp_connection::attach_client_with_capture,
};
use mainframe_types::http_status::StatusKind;
use serde::Deserialize;
use std::{
    net::SocketAddr,
    sync::{Arc, atomic::AtomicBool},
};
use tokio::sync::mpsc;

/// `?token=`/`?chatId=` on the LSP upgrade URL.
#[derive(Debug, Deserialize)]
pub(crate) struct LspWsQuery {
    token: Option<String>,
    #[serde(rename = "chatId")]
    chat_id: Option<String>,
}

/// The `/lsp/:projectId/:language` WS route handler. Self-authenticates (token
/// query param unless loopback), validates + spawns the language server via the
/// `LspConnectionHandler`, then bridges the accepted socket to the child process.
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

    let manager = ctx.infra.lsp_manager.clone();

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
    let handler = LspConnectionHandler::new(Arc::clone(&manager));
    match handler
        .handle_upgrade(&project_id, &language, &scope.path)
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

/// The bare status response that refuses an LSP upgrade.
fn reject_response(kind: StatusKind) -> Response {
    crate::respond::status_code(kind).into_response()
}

/// Bridge an accepted LSP WebSocket to its spawned language-server child: cancel
/// the idle reaper, attach the client (first-connect capture vs reconnect
/// replay), relay frames both ways, and on disconnect detach + restart the idle
/// timer.
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
