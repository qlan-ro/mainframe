//! Id-correlated request/response over the Codex app-server's line-delimited JSON
//! framing (multiple objects per line, partial-object scanning). 30s request
//! timeout; notification + server-request handlers; close listeners.

use mainframe_types::sync::LockExt as _;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::time::Duration;

use serde_json::{Map, Value};
use tokio::process::Child;
use tokio::sync::{Notify, oneshot};

use crate::types::{
    RequestId, is_json_rpc_error, is_json_rpc_notification, is_json_rpc_response,
    is_json_rpc_server_request,
};

const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 30_000;
const STDERR_TAIL_LINES: usize = 20;

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct JsonRpcError(pub String);

impl From<JsonRpcError> for mainframe_adapter_api::AdapterError {
    /// A JSON-RPC error reply's text is the app-server's own.
    fn from(error: JsonRpcError) -> Self {
        Self::Message(error.0)
    }
}

#[derive(Debug)]
pub(crate) enum RpcFailure {
    Rejected(JsonRpcError),
    NotWritten(JsonRpcError),
    Unconfirmed(JsonRpcError),
}
impl RpcFailure {
    fn into_error(self) -> JsonRpcError {
        match self {
            Self::Rejected(error) | Self::NotWritten(error) | Self::Unconfirmed(error) => error,
        }
    }
}
type PendingTx = oneshot::Sender<Result<Value, RpcFailure>>;

/// The four callbacks the client fans events out to (mirrors `JsonRpcHandlers`).
pub struct JsonRpcHandlers {
    pub on_notification: Box<dyn Fn(String, Value) + Send + Sync>,
    pub on_request: Box<dyn Fn(String, Value, RequestId) + Send + Sync>,
    pub on_error: Box<dyn Fn(String) + Send + Sync>,
    pub on_exit: Box<dyn Fn(Option<i32>) + Send + Sync>,
}

pub struct JsonRpcClient {
    next_id: AtomicI64,
    pending: Arc<Mutex<HashMap<RequestId, PendingTx>>>,
    closed: Arc<AtomicBool>,
    exited: Arc<AtomicBool>,
    close_notify: Arc<Notify>,
    kill_notify: Arc<Notify>,
    write_tx: mainframe_runtime::process::StdinWriter,
    request_timeout_ms: u64,
}

impl JsonRpcClient {
    pub async fn request(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, JsonRpcError> {
        self.request_with_disposition(method, params)
            .await
            .map_err(RpcFailure::into_error)
    }
    pub(crate) async fn request_with_disposition(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, RpcFailure> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(RpcFailure::NotWritten(JsonRpcError(
                "Client closed".to_string(),
            )));
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let req_id = RequestId::Number(id);
        let msg = serde_json::json!({ "id": id, "method": method, "params": params.unwrap_or(Value::Object(Map::new())) });
        let (tx, rx) = oneshot::channel();
        self.pending.lock_recover().insert(req_id.clone(), tx);
        if let Err(error) = self.write(&msg) {
            self.pending.lock_recover().remove(&req_id);
            return Err(RpcFailure::NotWritten(JsonRpcError(format!(
                "Request {method} (id={id}) not written: {error}"
            ))));
        }

        match tokio::time::timeout(Duration::from_millis(self.request_timeout_ms), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_recv)) => Err(RpcFailure::Unconfirmed(JsonRpcError(
                "Client closed".to_string(),
            ))),
            Err(_elapsed) => {
                self.pending.lock_recover().remove(&req_id);
                Err(RpcFailure::Unconfirmed(JsonRpcError(format!(
                    "Request {method} (id={id}) timed out after {}ms",
                    self.request_timeout_ms
                ))))
            }
        }
    }

    pub fn notify(&self, method: &str, params: Option<Value>) {
        if self.closed.load(Ordering::SeqCst) {
            return;
        }
        let msg = serde_json::json!({ "method": method, "params": params.unwrap_or(Value::Object(Map::new())) });
        if let Err(error) = self.write(&msg) {
            tracing::warn!(method, %error, "notification not written");
        }
    }

    /// Answer a server request (an approval or user-input reply). A closed
    /// client or stdin is the exit path's business and is only logged; a full
    /// queue is the caller's error, since the server would otherwise wait on
    /// an answer that never arrives.
    pub fn respond(&self, id: RequestId, result: Value) -> Result<(), JsonRpcError> {
        if self.closed.load(Ordering::SeqCst) {
            tracing::debug!(?id, "response skipped: client closed");
            return Ok(());
        }
        let msg = serde_json::json!({ "id": id, "result": result });
        match self.write(&msg) {
            Ok(()) => Ok(()),
            Err(error @ mainframe_runtime::process::StdinWriteError::Closed) => {
                tracing::debug!(?id, %error, "response not written");
                Ok(())
            }
            Err(error @ mainframe_runtime::process::StdinWriteError::Full) => {
                tracing::warn!(?id, %error, "response not written");
                Err(JsonRpcError(format!(
                    "Response to request {} not written: {error}",
                    serde_json::to_string(&id).unwrap_or_default()
                )))
            }
        }
    }

    pub fn close(&self) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        reject_all_pending(&self.pending, JsonRpcError("Client closed".to_string()));
        self.kill_notify.notify_one();
    }

    /// Future that resolves when the process closes (Rust-native alternative to
    /// `on_close` used by the session's kill race).
    pub async fn closed(&self) {
        let notified = self.close_notify.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        if !self.exited.load(Ordering::SeqCst) {
            notified.await;
        }
    }

    /// Queue one message for the app-server's stdin without waiting; a full
    /// queue (the server stopped reading) is an error, not a growing buffer.
    fn write(&self, msg: &Value) -> Result<(), mainframe_runtime::process::StdinWriteError> {
        let mut json = serde_json::to_string(msg).unwrap_or_default();
        json.push('\n');
        tracing::trace!("jsonrpc write");
        self.write_tx.try_write(json.into_bytes())
    }
}

fn reject_all_pending(pending: &Arc<Mutex<HashMap<RequestId, PendingTx>>>, err: JsonRpcError) {
    let drained: Vec<PendingTx> = pending.lock_recover().drain().map(|(_, tx)| tx).collect();
    for tx in drained {
        let _ = tx.send(Err(RpcFailure::Unconfirmed(JsonRpcError(err.0.clone()))));
    }
}

/// `2026-07-13T13:10:39.248771Z` — a `^\d{4}-\d{2}-\d{2}T[\d:.]+Z` prefix.
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Pure framing tests. A full stdin queue is covered in `write_tests.rs`;
    // the process-backed close/dispatch cases need a mock child process and
    // are a known test gap.

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

mod dispatch;
mod parsing;
mod process;
mod stderr;
#[cfg(test)]
mod write_tests;
use dispatch::dispatch;
use parsing::{parse_jsonrpc_messages, request_id_from_value};
use stderr::{is_panic_line, is_tracing_line};

impl Drop for JsonRpcClient {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
use parsing::find_json_object_end;

#[cfg(test)]
impl JsonRpcClient {
    pub(crate) fn test_transport() -> (Self, tokio::sync::mpsc::Receiver<Vec<u8>>) {
        let (write_tx, receiver) = mainframe_runtime::process::StdinWriter::channel(8);
        (
            Self {
                next_id: AtomicI64::new(1),
                pending: Arc::new(Mutex::new(HashMap::new())),
                closed: Arc::new(AtomicBool::new(false)),
                exited: Arc::new(AtomicBool::new(false)),
                close_notify: Arc::new(Notify::new()),
                kill_notify: Arc::new(Notify::new()),
                write_tx,
                request_timeout_ms: 100,
            },
            receiver,
        )
    }
    pub(crate) fn test_reject(&self, id: i64) {
        if let Some(sender) = self.pending.lock_recover().remove(&RequestId::Number(id)) {
            let _ = sender.send(Err(RpcFailure::Rejected(JsonRpcError("rejected".into()))));
        }
    }
    pub(crate) fn test_acknowledge(&self, id: i64) {
        if let Some(sender) = self.pending.lock_recover().remove(&RequestId::Number(id)) {
            let _ = sender.send(Ok(serde_json::json!({})));
        }
    }
}
