//! In-flight `tools/call` requests: how each one is registered, abandoned,
//! and forgotten.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use mainframe_types::sync::LockExt as _;
use tokio_util::sync::{CancellationToken, DropGuard};

use crate::credentials::Caller;
use crate::errors::{ErrorCode, ToolError};

/// One credential's running calls by request id, so `notifications/cancelled`
/// can end one.
#[derive(Debug, Default)]
pub(crate) struct InflightCalls {
    by_request: Mutex<HashMap<String, InflightCall>>,
    next_seq: AtomicU64,
}

/// `seq` tells a call from a later one that reuses its request id: a client
/// that reconnects may, while the abandoned call still runs.
#[derive(Debug)]
struct InflightCall {
    seq: u64,
    cancel: CancellationToken,
}

impl InflightCalls {
    pub(crate) fn cancel(&self, request_id: &str) {
        if let Some(call) = self.by_request.lock_recover().remove(request_id) {
            call.cancel.cancel();
        }
    }

    fn insert(&self, request_id: String, cancel: CancellationToken) -> u64 {
        let seq = self.next_seq.fetch_add(1, Ordering::Relaxed);
        self.by_request
            .lock_recover()
            .insert(request_id, InflightCall { seq, cancel });
        seq
    }

    fn remove(&self, request_id: &str, seq: u64) {
        let mut calls = self.by_request.lock_recover();
        if calls.get(request_id).is_some_and(|call| call.seq == seq) {
            calls.remove(request_id);
        }
    }
}

/// One in-flight `tools/call`. Dropping it forgets the call.
pub(crate) struct CallCtx {
    pub(crate) caller: Caller,
    /// The calling turn no longer wants this call: the client cancelled it,
    /// the chat was stopped, or its credential was revoked.
    pub(crate) cancel: CancellationToken,
    /// Nobody is left to read the reply: [`Self::cancel`] fired or the HTTP
    /// client disconnected. A disconnect is not a cancellation in MCP, so it
    /// ends a blocking wait but never undoes work the call started.
    pub(crate) abandoned: CancellationToken,
    request_id: String,
    seq: u64,
}

impl CallCtx {
    pub(crate) fn begin(caller: &Caller, request_id: String) -> Self {
        let cancel = caller.cancel.child_token();
        let seq = caller.calls.insert(request_id.clone(), cancel.clone());
        Self {
            caller: caller.clone(),
            abandoned: cancel.child_token(),
            cancel,
            request_id,
            seq,
        }
    }

    /// Marks the call abandoned when dropped: held by the HTTP request.
    pub(crate) fn abandon_on_drop(&self) -> DropGuard {
        self.abandoned.clone().drop_guard()
    }

    /// What a blocking wait reports once nobody reads its reply.
    pub(crate) fn wait_cancelled() -> ToolError {
        ToolError::new(
            ErrorCode::CallerNotActive,
            "The wait was cancelled because the calling turn stopped.",
        )
    }
}

impl Drop for CallCtx {
    fn drop(&mut self) {
        self.caller.calls.remove(&self.request_id, self.seq);
    }
}

#[cfg(test)]
#[path = "calls_tests.rs"]
mod tests;
