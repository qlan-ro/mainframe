//! Ported from `packages/core/src/lsp/lsp-connection.ts`.
//!
//! The upgrade path parser, the worktree-aware effective-path resolver, the
//! pre-upgrade validation/decision logic, and the client-attach orchestration
//! (cached-`initialize` replay for reconnecting clients, init-result capture for
//! the first client).
//!
//! Transport seam: the TS handler wrote raw HTTP status lines to a Node socket
//! and completed the upgrade via the `ws` library. The Rust server layer (axum)
//! is a separate, currently-deferred crate, so `handle_upgrade` returns an
//! [`UpgradeOutcome`] decision the server maps onto the socket, and
//! `attach_client` drives the bridge over channel seams instead of a concrete
//! `WebSocket`.

use std::sync::Arc;

use mainframe_types::chat::{Chat, Project};
use tokio::sync::mpsc;

use crate::lsp_manager::{LspManager, LspServerHandle};
use crate::lsp_proxy::bridge_ws_to_process;

/// Read-only project lookup (parity with `db.projects.get`).
pub trait ProjectStore: Send + Sync {
    fn get_project(&self, project_id: &str) -> Option<Project>;
}

/// Read-only chat lookup (parity with `chats.getChat`).
pub trait ChatStore: Send + Sync {
    fn get_chat(&self, chat_id: &str) -> Option<Chat>;
}

/// Parsed `/lsp/:projectId/:language` upgrade target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LspUpgradeTarget {
    pub project_id: String,
    pub language: String,
    pub chat_id: Option<String>,
}

/// Parse `/lsp/:projectId/:language` from a URL path. Returns `None` if not an LSP path.
pub fn parse_lsp_upgrade_path(url: &str) -> Option<LspUpgradeTarget> {
    let (pathname, qs) = match url.split_once('?') {
        Some((p, q)) => (p, q),
        None => (url, ""),
    };

    // Match `^/lsp/([^/]+)/([^/]+)$`.
    let rest = pathname.strip_prefix("/lsp/")?;
    let mut segments = rest.split('/');
    let project_id = segments.next()?;
    let language = segments.next()?;
    if project_id.is_empty() || language.is_empty() || segments.next().is_some() {
        return None;
    }

    let chat_id = parse_query_param(qs, "chatId");
    Some(LspUpgradeTarget {
        project_id: project_id.to_string(),
        language: language.to_string(),
        chat_id,
    })
}

/// Extract a single query-string parameter value (first occurrence).
fn parse_query_param(qs: &str, name: &str) -> Option<String> {
    qs.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        if k == name { Some(v.to_string()) } else { None }
    })
}

/// Worktree-aware effective path. Parity with `getEffectivePath`: the chat's
/// worktree when the chatId points to a live worktree; the project root otherwise.
/// Rejects cross-project access and missing worktrees by returning `None`.
pub fn get_effective_path(
    projects: &dyn ProjectStore,
    chats: Option<&dyn ChatStore>,
    project_id: &str,
    chat_id: Option<&str>,
) -> Option<String> {
    let project = projects.get_project(project_id)?;
    if let Some(chat_id) = chat_id
        && let Some(chat) = chats.and_then(|c| c.get_chat(chat_id))
    {
        // Guard: reject cross-project access.
        if chat.project_id != project_id {
            return None;
        }
        if let Some(worktree_path) = &chat.worktree_path
            && !worktree_path.is_empty()
        {
            if chat.worktree_missing == Some(true) {
                return None;
            }
            return Some(worktree_path.clone());
        }
    }
    Some(project.path)
}

/// The outcome of pre-upgrade validation. The server maps `Reject` onto the raw
/// HTTP status write + socket destroy, and `Proceed` onto accepting the WS.
pub enum UpgradeOutcome {
    /// Reject: the raw HTTP status line to write before destroying the socket.
    Reject(&'static str),
    /// Proceed: the spawned (or reattached) handle to bridge.
    Proceed(Arc<LspServerHandle>),
}

const REJECT_404: &str = "HTTP/1.1 404 Not Found\r\n\r\n";
const REJECT_409: &str = "HTTP/1.1 409 Conflict\r\n\r\n";
const REJECT_503: &str = "HTTP/1.1 503 Service Unavailable\r\n\r\n";

/// Handles `/lsp/...` WebSocket upgrades: validation, spawn, and client attach.
pub struct LspConnectionHandler<P: ProjectStore, C: ChatStore> {
    manager: Arc<LspManager>,
    db: Arc<P>,
    chats: Option<Arc<C>>,
}

impl<P: ProjectStore, C: ChatStore> LspConnectionHandler<P, C> {
    pub fn new(manager: Arc<LspManager>, db: Arc<P>) -> Self {
        Self {
            manager,
            db,
            chats: None,
        }
    }

    pub fn with_chats(manager: Arc<LspManager>, db: Arc<P>, chats: Arc<C>) -> Self {
        Self {
            manager,
            db,
            chats: Some(chats),
        }
    }

    /// Validate an upgrade, closing any stale client and spawning the server.
    /// Parity with `handleUpgrade` up to the point of completing the WS upgrade.
    pub async fn handle_upgrade(
        &self,
        project_id: &str,
        language: &str,
        chat_id: Option<&str>,
    ) -> UpgradeOutcome {
        // Validate project exists.
        if self.db.get_project(project_id).is_none() {
            tracing::warn!(
                project_id,
                language,
                "LSP upgrade rejected: unknown project"
            );
            return UpgradeOutcome::Reject(REJECT_404);
        }

        // Refuse a missing worktree with 409 so the client can surface a clear error
        // instead of silently falling back to the project root.
        if let (Some(chat_id), Some(chats)) = (chat_id, self.chats.as_ref())
            && let Some(chat) = chats.get_chat(chat_id)
            && chat.worktree_missing == Some(true)
        {
            tracing::warn!(
                project_id,
                language,
                chat_id,
                "LSP upgrade rejected: worktree missing"
            );
            return UpgradeOutcome::Reject(REJECT_409);
        }

        // Resolve effective path (worktree vs project root).
        let chats_ref = self.chats.as_ref().map(|c| c.as_ref() as &dyn ChatStore);
        let Some(effective_path) =
            get_effective_path(self.db.as_ref(), chats_ref, project_id, chat_id)
        else {
            tracing::warn!(
                project_id,
                language,
                ?chat_id,
                "LSP upgrade rejected: project or worktree not found"
            );
            return UpgradeOutcome::Reject(REJECT_404);
        };

        // Validate effective path exists on disk (async — no sync I/O).
        if let Err(err) = tokio::fs::metadata(&effective_path).await {
            tracing::warn!(%err, project_id, path = %effective_path, "LSP upgrade rejected: project path not found");
            return UpgradeOutcome::Reject(REJECT_404);
        }

        // Check the language-server config exists.
        if self.manager.registry().get_config(language).is_none() {
            tracing::warn!(language, "LSP upgrade rejected: unsupported language");
            return UpgradeOutcome::Reject(REJECT_404);
        }

        // Close any existing OPEN client so the new connection replaces it.
        if let Some(existing) = self.manager.get_handle(project_id, language) {
            let stale = {
                let prev = existing.set_client(None);
                match prev {
                    Some(client) if client.is_open() => Some(client),
                    // Not open (or absent): keep it detached (matches set to null).
                    _ => None,
                }
            };
            if let Some(client) = stale {
                tracing::info!(
                    project_id,
                    language,
                    "Closing stale LSP client for new connection"
                );
                existing.set_cleanup(None);
                client.close(1001, "Replaced by new client");
            }
        }

        // Spawn or reuse the server, worktree-aware.
        match self
            .manager
            .get_or_spawn(project_id, language, &effective_path)
            .await
        {
            Ok(handle) => UpgradeOutcome::Proceed(handle),
            Err(err) => {
                tracing::error!(%err, project_id, language, "Failed to spawn LSP server");
                UpgradeOutcome::Reject(REJECT_503)
            }
        }
    }
}

/// What to do with a reconnecting client's first message (parity with the
/// `onFirstMessage` handler in `onConnection`'s reattach branch).
#[derive(Debug, PartialEq, Eq)]
pub enum ReattachAction {
    /// `initialize` request with an id → replay the cached result under that id.
    ReplayInitialize { id: serde_json::Value },
    /// `initialized` notification → server already got it; start the real bridge.
    SkipInitialized,
    /// Anything else → start the bridge and forward the message.
    Forward,
}

/// Classify a reconnecting client's first message.
pub fn classify_reattach_first(msg: &str) -> ReattachAction {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(msg) else {
        return ReattachAction::Forward; // parse error → forward (TS `catch` fallthrough)
    };
    let method = value.get("method").and_then(|m| m.as_str());
    if method == Some("initialize")
        && let Some(id) = value.get("id")
        && !id.is_null()
    {
        return ReattachAction::ReplayInitialize { id: id.clone() };
    }
    if method == Some("initialized") {
        return ReattachAction::SkipInitialized;
    }
    ReattachAction::Forward
}

/// If `msg` is an `initialize` response carrying `result.capabilities`, return the
/// `result` to cache (parity with the `startBridgeWithInitCapture` sniff).
pub fn capture_initialize_result(msg: &str) -> Option<serde_json::Value> {
    let value = serde_json::from_str::<serde_json::Value>(msg).ok()?;
    let result = value.get("result")?;
    if result.get("capabilities").is_some() {
        Some(result.clone())
    } else {
        None
    }
}

/// Build the `initialize` reply the server replays to a reconnecting client.
pub fn cached_initialize_reply(id: &serde_json::Value, result: &serde_json::Value) -> String {
    serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}

/// Drive the WS<->child bridge for a first-connecting client, sniffing the
/// outgoing stream to cache the `initialize` result. The server calls this after
/// accepting the socket; `incoming`/`outgoing` are the client's message channels.
///
/// The reattach fast path (cached-`initialize` replay) is composed from
/// [`classify_reattach_first`] + [`cached_initialize_reply`] by the server before
/// handing the (drained) stream here.
// TODO(port): the server (axum) layer wires the accepted WebSocket to these
// channels and installs the on-close -> `start_idle_timer` hook; that glue lands
// with the deferred `mainframe-server` LSP mount.
pub fn attach_client_with_capture(
    handle: &Arc<LspServerHandle>,
    incoming: mpsc::UnboundedReceiver<String>,
    outgoing: mpsc::UnboundedSender<String>,
) {
    let Some(stdout) = handle.take_stdout() else {
        tracing::error!("LSP process missing stdout stream");
        return;
    };
    let Some(stderr) = handle.take_stderr() else {
        tracing::error!("LSP process missing stderr stream");
        return;
    };

    // Intercept outgoing frames to capture the `initialize` result before it
    // reaches the client (parity with wrapping `ws.send`).
    let (sniff_tx, mut sniff_rx) = mpsc::unbounded_channel::<String>();
    let handle_for_sniff = Arc::clone(handle);
    tokio::spawn(async move {
        let mut captured = false;
        while let Some(msg) = sniff_rx.recv().await {
            if !captured && let Some(result) = capture_initialize_result(&msg) {
                handle_for_sniff.set_initialize_result(result);
                captured = true;
                tracing::info!("Cached LSP initialize result");
            }
            if outgoing.send(msg).is_err() {
                break;
            }
        }
    });

    let bridge = bridge_ws_to_process(incoming, sniff_tx, handle.stdin_tx(), stdout, stderr);
    handle.set_cleanup(Some(bridge));
}

#[cfg(test)]
mod tests;

// PORT STATUS: packages/core/src/lsp/lsp-connection.ts (249 lines)
// confidence: medium (parser + effective-path + validation are direct ports and
//   tested; the WS-attach orchestration is ported over a channel seam because the
//   axum WS wiring lives in the deferred `mainframe-server` LSP mount)
// todos: 1 (server-side WS<->channel + on-close idle-timer glue — see TODO(port))
// notes: `getEffectivePath` is re-derived here via trait seams (`ProjectStore`/
//   `ChatStore`) rather than importing it from the server crate (would be a
//   dependency cycle: server -> lsp). Raw `socket.write('HTTP/1.1 …')` + destroy
//   becomes an `UpgradeOutcome::Reject(status)` the server writes. All log strings
//   preserved. The reattach-replay and init-capture logic is factored into pure,
//   tested helpers (`classify_reattach_first`, `capture_initialize_result`).
