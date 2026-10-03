use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde_json::Value;
use tokio::sync::OnceCell;
use tracing::warn;

use mainframe_adapter_api::SessionSink;
use mainframe_types::chat::MessageContent;
use mainframe_types::content::LeafContent;

use crate::adapter::first_version_triple;
use crate::session::ClaudeSession;
const PARTIAL_MESSAGES_MIN_VERSION: (u64, u64, u64) = (1, 0, 109);
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
#[derive(Debug)]
pub struct PartialMessageState {
    pub api_message_id: Option<String>,
    pub block: Option<PartialBlock>,
    pub last_emit_ms: Option<i64>,
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
    pub fn clear(&mut self) {
        self.api_message_id = None;
        self.block = None;
        self.last_emit_ms = None;
    }
    pub fn clear_block(&mut self) {
        self.block = None;
    }
}
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
    let id = if inner.get("type").and_then(Value::as_str) == Some("message_start") {
        inner
            .get("message")
            .and_then(|m| m.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string)
    } else {
        guard.partial.api_message_id.clone()
    };
    let stop = inner
        .get("delta")
        .and_then(|d| d.get("stop_reason"))
        .and_then(Value::as_str);
    let context = id.as_deref().and_then(|id| {
        guard
            .presentation
            .observe(event, Some(id), None, stop, sink)
    });
    let partial = &mut guard.partial;

    let emit = update_partial(partial, inner);

    drop(guard);
    if let Some((message_id, kind, text)) = emit {
        let content = vec![leaf_for(kind, text)];
        if let Some(context) = context {
            sink.on_message_partial_with_presentation(&message_id, content, context);
        } else {
            sink.on_message_partial(&message_id, content);
        }
    }
}
fn accumulate_delta(
    partial: &mut PartialMessageState,
    inner: &Value,
) -> Option<(String, PartialBlockKind, String)> {
    let delta = inner.get("delta")?;
    let piece = match delta.get("type").and_then(Value::as_str) {
        Some("text_delta") => delta.get("text").and_then(Value::as_str)?,
        Some("thinking_delta") => delta.get("thinking").and_then(Value::as_str)?,
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
pub async fn supports_partial_messages(executable: &str, resolved_path: &str) -> bool {
    static CACHE: OnceLock<Mutex<HashMap<String, Arc<OnceCell<bool>>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    let cell = cache
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .entry(executable.to_string())
        .or_insert_with(|| Arc::new(OnceCell::new()))
        .clone();
    *cell
        .get_or_init(|| probe_and_log(executable, resolved_path))
        .await
}
async fn probe_and_log(executable: &str, resolved_path: &str) -> bool {
    match probe_version(executable, resolved_path).await {
        None => {
            warn!(
                reason = executable,
                "claude: --include-partial-messages probe failed or timed out; downgrading to legacy streaming"
            );
            false
        }
        Some(version) if !version_at_least(&version, PARTIAL_MESSAGES_MIN_VERSION) => {
            warn!(
                reason = executable,
                version,
                "claude: CLI version below --include-partial-messages minimum; downgrading to legacy streaming"
            );
            false
        }
        Some(_) => true,
    }
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
mod probe_tests;
#[cfg(test)]
mod tests;

fn update_partial(
    partial: &mut PartialMessageState,
    inner: &Value,
) -> Option<(String, PartialBlockKind, String)> {
    match inner.get("type").and_then(Value::as_str) {
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
                _ => None,
            };
            partial.block = kind.map(|kind| PartialBlock {
                kind,
                text: String::new(),
            });
            None
        }
        Some("content_block_delta") => accumulate_delta(partial, inner),
        Some("content_block_stop") | Some("message_delta") => {
            partial.clear_block();
            None
        }
        Some("message_stop") => {
            partial.clear();
            None
        }
        _ => None,
    }
}
