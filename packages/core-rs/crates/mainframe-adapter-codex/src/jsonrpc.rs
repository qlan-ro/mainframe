//! Ported from `packages/core/src/plugins/builtin/codex/jsonrpc.ts`.
//!
//! Id-correlated request/response over the Codex app-server's line-delimited JSON
//! framing (the framing — multiple objects per line, partial-object scanning — is
//! copied exactly from the TS). 30s request timeout; notification + server-request
//! handlers; close listeners.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::time::Duration;

use serde_json::{Map, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Child;
use tokio::sync::{Notify, mpsc, oneshot};

use crate::types::{
    RequestId, is_json_rpc_error, is_json_rpc_notification, is_json_rpc_response,
    is_json_rpc_server_request,
};

const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 30_000;

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct JsonRpcError(pub String);

type PendingTx = oneshot::Sender<Result<Value, JsonRpcError>>;
type CloseListener = Box<dyn Fn() + Send + Sync>;

/// The four callbacks the client fans events out to (mirrors `JsonRpcHandlers`).
pub struct JsonRpcHandlers {
    pub on_notification: Box<dyn Fn(String, Value) + Send + Sync>,
    pub on_request: Box<dyn Fn(String, Value, RequestId) + Send + Sync>,
    pub on_error: Box<dyn Fn(String) + Send + Sync>,
    pub on_exit: Box<dyn Fn(Option<i32>) + Send + Sync>,
}

/// `findJsonObjectEnd` — index one past the end of the first complete top-level
/// JSON object in `input`, or `None` if there isn't one. Copied char-for-char.
fn find_json_object_end(input: &str) -> Option<usize> {
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;

    for (i, ch) in input.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        if ch == '"' {
            in_string = true;
        } else if ch == '{' {
            depth += 1;
        } else if ch == '}' {
            depth -= 1;
            if depth == 0 {
                return Some(i + ch.len_utf8());
            }
        } else if depth == 0 && !ch.is_whitespace() {
            return None;
        }
    }

    None
}

/// Parse one stdout line into 1+ JSON objects (the app-server occasionally
/// concatenates objects on a single line). Errors if a partial object is found.
fn parse_jsonrpc_messages(line: &str) -> Result<Vec<Map<String, Value>>, JsonRpcError> {
    let mut messages: Vec<Map<String, Value>> = Vec::new();
    let mut rest = line.trim();

    while !rest.is_empty() {
        match serde_json::from_str::<Value>(rest) {
            Ok(Value::Object(m)) => {
                messages.push(m);
                return Ok(messages);
            }
            Ok(_) => return Ok(messages),
            Err(_) => {
                let end = find_json_object_end(rest)
                    .ok_or_else(|| JsonRpcError("No complete JSON object found".to_string()))?;
                match serde_json::from_str::<Value>(&rest[..end]) {
                    Ok(Value::Object(m)) => messages.push(m),
                    _ => return Err(JsonRpcError("No complete JSON object found".to_string())),
                }
                rest = rest[end..].trim();
                if !rest.starts_with('{') {
                    return Ok(messages);
                }
            }
        }
    }

    Ok(messages)
}

fn request_id_from_value(v: &Value) -> Option<RequestId> {
    match v {
        Value::Number(n) => n.as_i64().map(RequestId::Number),
        Value::String(s) => Some(RequestId::String(s.clone())),
        _ => None,
    }
}

pub struct JsonRpcClient {
    next_id: AtomicI64,
    pending: Arc<Mutex<HashMap<RequestId, PendingTx>>>,
    closed: Arc<AtomicBool>,
    exited: Arc<AtomicBool>,
    close_listeners: Arc<Mutex<Vec<CloseListener>>>,
    close_notify: Arc<Notify>,
    kill_notify: Arc<Notify>,
    write_tx: mpsc::UnboundedSender<Vec<u8>>,
    request_timeout_ms: u64,
}

impl JsonRpcClient {
    pub fn new(child: Child, handlers: JsonRpcHandlers) -> Self {
        Self::with_timeout(child, handlers, DEFAULT_REQUEST_TIMEOUT_MS)
    }

    pub fn with_timeout(
        mut child: Child,
        handlers: JsonRpcHandlers,
        request_timeout_ms: u64,
    ) -> Self {
        let pending: Arc<Mutex<HashMap<RequestId, PendingTx>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let closed = Arc::new(AtomicBool::new(false));
        let exited = Arc::new(AtomicBool::new(false));
        let close_listeners: Arc<Mutex<Vec<CloseListener>>> = Arc::new(Mutex::new(Vec::new()));
        let close_notify = Arc::new(Notify::new());
        let kill_notify = Arc::new(Notify::new());
        let handlers = Arc::new(handlers);

        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Writer task — owns stdin; all writes are non-blocking channel sends.
        let (write_tx, mut write_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        if let Some(mut stdin) = stdin {
            tokio::spawn(async move {
                while let Some(bytes) = write_rx.recv().await {
                    if stdin.write_all(&bytes).await.is_err() {
                        break;
                    }
                    let _ = stdin.flush().await;
                }
            });
        }

        // Stdout reader task — parse + dispatch.
        if let Some(stdout) = stdout {
            let pending = pending.clone();
            let handlers = handlers.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if line.trim().is_empty() {
                        continue;
                    }
                    tracing::trace!(module = "codex:jsonrpc", line, "jsonrpc recv");
                    match parse_jsonrpc_messages(&line) {
                        Ok(msgs) => {
                            for msg in msgs {
                                dispatch(&msg, &pending, &handlers);
                            }
                        }
                        Err(_) => {
                            let head: String = line.chars().take(200).collect();
                            tracing::warn!(
                                module = "codex:jsonrpc",
                                line = head,
                                "jsonrpc: malformed JSON line"
                            );
                        }
                    }
                }
            });
        }

        // Stderr reader task — filter noise, surface the rest.
        if let Some(stderr) = stderr {
            let handlers = handlers.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let message = line.trim();
                    if message.is_empty() || is_stderr_noise(message) {
                        continue;
                    }
                    tracing::warn!(module = "codex:jsonrpc", stderr = message, "codex stderr");
                    (handlers.on_error)(message.to_string());
                }
            });
        }

        // Exit watcher — resolve on process exit (or an explicit kill request);
        // reject pending + fire close.
        {
            let pending = pending.clone();
            let close_listeners = close_listeners.clone();
            let close_notify = close_notify.clone();
            let kill_notify = kill_notify.clone();
            let exited = exited.clone();
            let handlers = handlers.clone();
            tokio::spawn(async move {
                let code = tokio::select! {
                    status = child.wait() => status.ok().and_then(|s| s.code()),
                    _ = kill_notify.notified() => {
                        let _ = child.start_kill();
                        child.wait().await.ok().and_then(|s| s.code())
                    }
                };
                exited.store(true, Ordering::SeqCst);
                reject_all_pending(
                    &pending,
                    JsonRpcError(format!("Process exited with code {code:?}")),
                );
                for listener in close_listeners
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .drain(..)
                {
                    listener();
                }
                close_notify.notify_waiters();
                (handlers.on_exit)(code);
            });
        }

        Self {
            next_id: AtomicI64::new(1),
            pending,
            closed,
            exited,
            close_listeners,
            close_notify,
            kill_notify,
            write_tx,
            request_timeout_ms,
        }
    }

    pub async fn request(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, JsonRpcError> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(JsonRpcError("Client closed".to_string()));
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req_id = RequestId::Number(id);
        let msg = serde_json::json!({ "id": id, "method": method, "params": params.unwrap_or(Value::Object(Map::new())) });
        let (tx, rx) = oneshot::channel();
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(req_id.clone(), tx);
        self.write(&msg);

        match tokio::time::timeout(Duration::from_millis(self.request_timeout_ms), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_recv)) => Err(JsonRpcError("Client closed".to_string())),
            Err(_elapsed) => {
                self.pending
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&req_id);
                Err(JsonRpcError(format!(
                    "Request {method} (id={id}) timed out after {}ms",
                    self.request_timeout_ms
                )))
            }
        }
    }

    pub fn notify(&self, method: &str, params: Option<Value>) {
        if self.closed.load(Ordering::SeqCst) {
            return;
        }
        let msg = serde_json::json!({ "method": method, "params": params.unwrap_or(Value::Object(Map::new())) });
        self.write(&msg);
    }

    pub fn respond(&self, id: RequestId, result: Value) {
        if self.closed.load(Ordering::SeqCst) {
            return;
        }
        let msg = serde_json::json!({ "id": id, "result": result });
        self.write(&msg);
    }

    pub fn close(&self) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        reject_all_pending(&self.pending, JsonRpcError("Client closed".to_string()));
        // Signal the exit watcher (which owns the child) to terminate it.
        // TODO(port): TS sends SIGTERM explicitly; start_kill() uses SIGKILL (no
        // signal crate in the allowlist). The child dies with the client either way
        // (detached:false parity).
        self.kill_notify.notify_waiters();
    }

    /// Register a close listener (mirrors `onClose`). The returned unsubscribe is a
    /// no-op: listeners are drained exactly once when the process exits, so a stored
    /// listener never fires twice (the session's only use is a one-shot wake).
    pub fn on_close(&self, listener: CloseListener) {
        self.close_listeners
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(listener);
    }

    /// Future that resolves when the process closes (Rust-native alternative to
    /// `on_close` used by the session's kill race).
    pub async fn closed(&self) {
        if self.exited.load(Ordering::SeqCst) {
            return;
        }
        self.close_notify.notified().await;
    }

    fn write(&self, msg: &Value) {
        let mut json = serde_json::to_string(msg).unwrap_or_default();
        json.push('\n');
        tracing::trace!(module = "codex:jsonrpc", "jsonrpc write");
        let _ = self.write_tx.send(json.into_bytes());
    }
}

fn dispatch(
    msg: &Map<String, Value>,
    pending: &Arc<Mutex<HashMap<RequestId, PendingTx>>>,
    handlers: &Arc<JsonRpcHandlers>,
) {
    if is_json_rpc_response(msg) {
        if let Some(id) = msg.get("id").and_then(request_id_from_value)
            && let Some(tx) = pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&id)
        {
            let _ = tx.send(Ok(msg.get("result").cloned().unwrap_or(Value::Null)));
        }
        return;
    }

    if is_json_rpc_error(msg) {
        if let Some(id) = msg.get("id").and_then(request_id_from_value)
            && let Some(tx) = pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&id)
        {
            let message = msg
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("")
                .to_string();
            let _ = tx.send(Err(JsonRpcError(message)));
        }
        return;
    }

    if is_json_rpc_server_request(msg) {
        if let (Some(method), Some(id)) = (
            msg.get("method").and_then(|m| m.as_str()),
            msg.get("id").and_then(request_id_from_value),
        ) {
            (handlers.on_request)(
                method.to_string(),
                msg.get("params").cloned().unwrap_or(Value::Null),
                id,
            );
        }
        return;
    }

    if is_json_rpc_notification(msg) {
        if let Some(method) = msg.get("method").and_then(|m| m.as_str()) {
            (handlers.on_notification)(
                method.to_string(),
                msg.get("params").cloned().unwrap_or(Value::Null),
            );
        }
        return;
    }

    tracing::warn!(
        module = "codex:jsonrpc",
        "jsonrpc: unrecognized message shape"
    );
}

fn reject_all_pending(pending: &Arc<Mutex<HashMap<RequestId, PendingTx>>>, err: JsonRpcError) {
    let drained: Vec<PendingTx> = pending
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .drain()
        .map(|(_, tx)| tx)
        .collect();
    for tx in drained {
        let _ = tx.send(Err(JsonRpcError(err.0.clone())));
    }
}

/// The stderr noise filter (`STDERR_NOISE`) — hand-rolled (no regex crate).
fn is_stderr_noise(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.starts_with("debugger")
        || lower.starts_with("warning:")
        || message.starts_with("DeprecationWarning")
        || message.starts_with("ExperimentalWarning")
        || (message.starts_with("(node:") && message.contains(')'))
        || (message.starts_with("thread '") && message.contains("panicked"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Pure framing subset of codex-jsonrpc.test.ts (the client-level request/respond/
    // close/dispatch cases need a mock ChildProcess and are noted as a test gap).

    #[test]
    fn parses_a_single_json_object_line() {
        let msgs =
            parse_jsonrpc_messages(r#"{"method":"turn/started","params":{}}"#).expect("parse");
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].get("method"), Some(&json!("turn/started")));
    }

    #[test]
    fn dispatches_a_valid_object_before_trailing_stdout_noise_on_the_same_line() {
        let notification = r#"{"method":"thread/tokenUsage/updated","params":{"tokenUsage":{"total":{"totalTokens":20805}}}}"#;
        let line = format!("{notification}progress: still running");
        let msgs = parse_jsonrpc_messages(&line).expect("parse");
        assert_eq!(msgs.len(), 1);
        assert_eq!(
            msgs[0].get("method"),
            Some(&json!("thread/tokenUsage/updated"))
        );
    }

    #[test]
    fn skips_malformed_json_lines() {
        assert!(parse_jsonrpc_messages("not valid json").is_err());
    }

    #[test]
    fn find_json_object_end_returns_index_past_first_object() {
        assert_eq!(find_json_object_end(r#"{"a":1}{"b":2}"#), Some(7));
        // A `}` inside a string must NOT close the object (depth tracking + string skip).
        assert_eq!(find_json_object_end(r#"{"a":"}"}"#), Some(9));
        assert_eq!(find_json_object_end(r#"{"a":1"#), None);
    }
}

// PORT STATUS: src/plugins/builtin/codex/jsonrpc.ts (227 lines)
// confidence: medium
// todos: 1
// notes: The line framing (parse_jsonrpc_messages + find_json_object_end) is copied
// notes: char-for-char. Concurrency per CONCURRENCY.tsv 96-100: pending is
// notes: Arc<Mutex<HashMap>>, next_id AtomicI64, closed AtomicBool, close_listeners a
// notes: drained-once Vec + a Notify for the Rust-native `closed()` await. Writes go
// notes: through an mpsc to a stdin writer task so notify/respond/write stay sync
// notes: (TS stdin.write is sync). TODO(port): close() relies on kill_on_drop(SIGKILL)
// notes: rather than an explicit SIGTERM (no signal crate in the allowlist); parity
// notes: on "child dies with the client" holds. on_close's unsubscribe is a no-op
// notes: (listeners drain exactly once on exit). request() returns raw Value; callers
// notes: deserialize. TEST GAP: `__tests__/codex-jsonrpc.test.ts` (10 cases) is NOT
// notes: ported — most cases inject a mock ChildProcess (EventEmitter stdin/stdout),
// notes: but JsonRpcClient::new takes a concrete tokio Child, so faithfully porting
// notes: request/respond/close/dispatch tests needs a generic-stream refactor
// notes: (a redesign, out of scope for a structure-preserving port). The pure framing
// notes: functions (parse_jsonrpc_messages/find_json_object_end) ARE unit-tested inline
// notes: below; the client-level request/respond/close/dispatch cases remain a gap.
