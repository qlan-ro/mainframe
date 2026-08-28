//! `--include-partial-messages` adoption (todo #350, AGENT-SDK-PARITY B4):
//! the capability gate for passing the flag, and the `stream_event` handler
//! that accumulates text/thinking deltas into
//! [`SessionSink::on_message_partial`] calls.
//!
//! Live-verified against CLI 2.1.224 (probe capture 2026-08-28): the wrapper
//! is `{type:"stream_event", event, session_id, parent_tool_use_id: null,
//! uuid}` where `uuid` is a fresh random per event (NOT the transcript entry
//! uuid of any later `assistant` event); the anchor that survives to the
//! completed message is `message_start`'s `event.message.id`, which every
//! `assistant` event of that API message repeats as `message.id`. The
//! completed `assistant` event for a block arrives BEFORE that block's
//! `content_block_stop`, and delta concatenation equals the completed block's
//! text exactly. Subagent stream events never reach stdout (the CLI's
//! `runAgent` drops them).
//!
//! `input_json_delta` (tool-input streaming) is deliberately ignored — spec
//! Decision 7 phases tool-input deltas after text/reasoning.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::Value;

use mainframe_adapter_api::SessionSink;
use mainframe_types::chat::MessageContent;
use mainframe_types::content::LeafContent;

use crate::adapter::first_version_triple;
use crate::session::ClaudeSession;

/// `--include-partial-messages` landed in CLI 1.0.109 (upstream CHANGELOG).
const PARTIAL_MESSAGES_MIN_VERSION: (u64, u64, u64) = (1, 0, 109);

/// Floor between partial emissions per session: every emission re-runs the
/// display pipeline over the chat's whole message list, so token-rate calls
/// would make that cost per-delta. 20/s keeps streaming visibly live while
/// bounding the recompute; the completing `assistant` event delivers the
/// final text with no gate, so nothing is ever lost to the window.
const PARTIAL_EMIT_INTERVAL_MS: i64 = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PartialBlockKind {
    Text,
    Thinking,
}

#[derive(Debug, Clone)]
pub struct PartialBlock {
    pub kind: PartialBlockKind,
    pub text: String,
}

/// Per-session accumulation state, held in `ClaudeSessionState`.
#[derive(Debug)]
pub struct PartialMessageState {
    pub api_message_id: Option<String>,
    pub block: Option<PartialBlock>,
    pub last_emit_ms: Option<i64>,
    /// Overridable so tests can set 0 (emit every delta) or force the gate.
    pub emit_interval_ms: i64,
}

impl Default for PartialMessageState {
    fn default() -> Self {
        Self {
            api_message_id: None,
            block: None,
            last_emit_ms: None,
            emit_interval_ms: PARTIAL_EMIT_INTERVAL_MS,
        }
    }
}

impl PartialMessageState {
    /// Full reset: message over (`message_stop`), turn over (`result`), or
    /// the API call was aborted (`api_error` retry).
    pub fn clear(&mut self) {
        self.api_message_id = None;
        self.block = None;
        self.last_emit_ms = None;
    }

    /// The in-flight block materialized as a completed `assistant` event (or
    /// closed via `content_block_stop`); later blocks of the same message
    /// keep accumulating under the same `api_message_id`.
    pub fn clear_block(&mut self) {
        self.block = None;
    }
}

/// Should a delta at `now_ms` emit, given the last emission? First delta of a
/// message always does (`last` is `None`).
fn emit_due(last: Option<i64>, interval_ms: i64, now_ms: i64) -> bool {
    last.is_none_or(|last| now_ms - last >= interval_ms)
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn leaf_for(kind: PartialBlockKind, text: String) -> MessageContent {
    match kind {
        PartialBlockKind::Text => MessageContent::Leaf(LeafContent::Text {
            text,
            parent_tool_use_id: None,
        }),
        PartialBlockKind::Thinking => MessageContent::Leaf(LeafContent::Thinking {
            thinking: text,
            parent_tool_use_id: None,
        }),
    }
}

pub fn handle_stream_event(session: &ClaudeSession, event: &Value, sink: &dyn SessionSink) {
    // Defensive: subagent stream events don't reach stdout today; if that
    // ever changes they must not pollute the top-level message's overlay.
    if event
        .get("parent_tool_use_id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .is_some()
    {
        return;
    }
    let Some(inner) = event.get("event") else {
        return;
    };

    let mut guard = session.state.lock().unwrap_or_else(|e| e.into_inner());
    let partial = &mut guard.partial;

    let emit = match inner.get("type").and_then(Value::as_str) {
        Some("message_start") => {
            partial.clear();
            partial.api_message_id = inner
                .get("message")
                .and_then(|m| m.get("id"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            None
        }
        Some("content_block_start") => {
            let kind = match inner
                .get("content_block")
                .and_then(|b| b.get("type"))
                .and_then(Value::as_str)
            {
                Some("text") => Some(PartialBlockKind::Text),
                Some("thinking") => Some(PartialBlockKind::Thinking),
                // tool_use (input_json_delta), redacted_thinking, …: not
                // streamed this phase.
                _ => None,
            };
            partial.block = kind.map(|kind| PartialBlock {
                kind,
                text: String::new(),
            });
            None
        }
        Some("content_block_delta") => accumulate_delta(partial, inner),
        // The completed block already arrived as an `assistant` event
        // (verified ordering: assistant precedes content_block_stop).
        Some("content_block_stop") | Some("message_delta") => {
            partial.clear_block();
            None
        }
        Some("message_stop") => {
            partial.clear();
            None
        }
        _ => None,
    };

    drop(guard);
    if let Some((message_id, kind, text)) = emit {
        sink.on_message_partial(&message_id, vec![leaf_for(kind, text)]);
    }
}

/// Append a text/thinking delta to the in-flight block; when the emission
/// gate is open and the accumulation is non-empty (hidden-thinking models
/// stream empty `thinking` deltas), return what to hand the sink.
fn accumulate_delta(
    partial: &mut PartialMessageState,
    inner: &Value,
) -> Option<(String, PartialBlockKind, String)> {
    let delta = inner.get("delta")?;
    let piece = match delta.get("type").and_then(Value::as_str) {
        Some("text_delta") => delta.get("text").and_then(Value::as_str)?,
        Some("thinking_delta") => delta.get("thinking").and_then(Value::as_str)?,
        // signature_delta / input_json_delta: ignored this phase.
        _ => return None,
    };
    let message_id = partial.api_message_id.clone()?;
    let block = partial.block.as_mut()?;
    block.text.push_str(piece);
    if block.text.is_empty() {
        return None;
    }
    let now = now_ms();
    if !emit_due(partial.last_emit_ms, partial.emit_interval_ms, now) {
        return None;
    }
    partial.last_emit_ms = Some(now);
    let block = partial.block.as_ref()?;
    Some((message_id, block.kind, block.text.clone()))
}

/// Does `executable` accept `--include-partial-messages`? One `--version`
/// spawn per executable per daemon lifetime (measured ~60ms), cached because
/// every session spawn asks. Unknown/unparseable/failed probes gate to
/// `false` — the flag is an optimization, a failed spawn is an outage.
pub async fn supports_partial_messages(executable: &str, resolved_path: &str) -> bool {
    static CACHE: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    if let Some(hit) = cache
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(executable)
        .copied()
    {
        return hit;
    }
    let supported = probe_version(executable, resolved_path)
        .await
        .map(|version| version_at_least(&version, PARTIAL_MESSAGES_MIN_VERSION))
        .unwrap_or(false);
    cache
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(executable.to_string(), supported);
    supported
}

async fn probe_version(executable: &str, resolved_path: &str) -> Option<String> {
    let output = tokio::time::timeout(
        Duration::from_secs(5),
        tokio::process::Command::new(executable)
            .arg("--version")
            .env("PATH", resolved_path)
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        return None;
    }
    first_version_triple(&String::from_utf8_lossy(&output.stdout))
}

fn version_at_least(version: &str, min: (u64, u64, u64)) -> bool {
    let mut parts = version.split('.').map(str::parse::<u64>);
    let (Some(Ok(major)), Some(Ok(minor)), Some(Ok(patch))) =
        (parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    (major, minor, patch) >= min
}

#[cfg(test)]
mod tests;
