//! Ported from `packages/core/src/lsp/lsp-proxy.ts`.
//!
//! The WS <-> child-stdio bridge. LSP frames its JSON-RPC messages with a
//! `Content-Length` header; this module owns the byte-accurate framing in both
//! directions. Per PORTING.md §2.13 the framing is hand-rolled — no LSP crate.

use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

const HEADER_SEPARATOR: &[u8] = b"\r\n\r\n";

/// Wrap a JSON string with an LSP `Content-Length` header. The length is the
/// UTF-8 **byte** count of the payload (parity with `Buffer.byteLength`).
pub fn encode_json_rpc(json: &str) -> String {
    let byte_length = json.len();
    format!("Content-Length: {byte_length}\r\n\r\n{json}")
}

/// Find the first occurrence of `needle` in `haystack`. Byte-level `indexOf`.
fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Extract the `Content-Length` value from a header block, matching the TS
/// regex `/Content-Length:\s*(\d+)/i` (case-insensitive, leading whitespace).
fn parse_content_length(header: &str) -> Option<usize> {
    let lower = header.to_ascii_lowercase();
    let idx = lower.find("content-length:")?;
    let rest = &header[idx + "content-length:".len()..];
    let digits: String = rest
        .trim_start_matches([' ', '\t', '\r', '\n'])
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<usize>().ok()
}

/// Incremental `Content-Length` frame parser. Feed raw stdout chunks; drain
/// every complete JSON message. Mirrors the `onStdoutData` loop byte-for-byte.
#[derive(Default)]
pub struct LspFrameParser {
    buffer: Vec<u8>,
}

impl LspFrameParser {
    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    /// Append `chunk` and return every JSON message that became complete.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(chunk);
        let mut out = Vec::new();

        loop {
            let Some(header_end) = find_subsequence(&self.buffer, HEADER_SEPARATOR) else {
                break;
            };

            let header = String::from_utf8_lossy(&self.buffer[..header_end]).into_owned();
            let Some(content_length) = parse_content_length(&header) else {
                tracing::warn!(header = %header, "Malformed LSP header, discarding");
                self.buffer.drain(..header_end + 4);
                continue;
            };

            let content_start = header_end + 4;
            if self.buffer.len() < content_start + content_length {
                break;
            }

            let json = String::from_utf8_lossy(
                &self.buffer[content_start..content_start + content_length],
            )
            .into_owned();
            self.buffer.drain(..content_start + content_length);
            out.push(json);
        }

        out
    }
}

/// Owns the bridge's background tasks. Dropping it (or calling `cleanup`) aborts
/// them — the parity of the TS `cleanup()` that removed every stream listener.
pub struct BridgeHandle {
    tasks: Vec<JoinHandle<()>>,
}

impl BridgeHandle {
    /// Abort every pump task. Idempotent.
    pub fn cleanup(&self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}

impl Drop for BridgeHandle {
    fn drop(&mut self) {
        self.cleanup();
    }
}

/// Bridge a WebSocket to an LSP child's stdio.
///
/// Transport seam (the axum WS wiring lives in the deferred server layer):
/// - `incoming`: client -> daemon JSON text messages.
/// - `outgoing`: daemon -> client sink; a closed receiver means the WS is gone
///   (parity with the `ws.readyState === OPEN` guard — a failed send stops us).
/// - `stdin_tx`: framed bytes to the child's single stdin writer task (both this
///   bridge and graceful shutdown feed it, mirroring the shared `proc.stdin`).
/// - `stdout`/`stderr`: the child's pipes.
pub fn bridge_ws_to_process<O, E>(
    mut incoming: mpsc::UnboundedReceiver<String>,
    outgoing: mpsc::UnboundedSender<String>,
    stdin_tx: mpsc::UnboundedSender<Vec<u8>>,
    stdout: O,
    stderr: E,
) -> BridgeHandle
where
    O: AsyncRead + Unpin + Send + 'static,
    E: AsyncRead + Unpin + Send + 'static,
{
    // client -> child stdin (framed)
    let stdin_task = tokio::spawn(async move {
        while let Some(json) = incoming.recv().await {
            if stdin_tx.send(encode_json_rpc(&json).into_bytes()).is_err() {
                tracing::error!("Failed to write to LSP stdin");
                break;
            }
        }
    });

    // child stdout -> client (deframed)
    let stdout_task = tokio::spawn(async move {
        let mut stdout = stdout;
        let mut parser = LspFrameParser::new();
        let mut chunk = [0u8; 8192];
        loop {
            match stdout.read(&mut chunk).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    for json in parser.push(&chunk[..n]) {
                        // A closed receiver is the `ws not open` case: stop.
                        if outgoing.send(json).is_err() {
                            return;
                        }
                    }
                }
            }
        }
    });

    // child stderr -> log
    let stderr_task = tokio::spawn(async move {
        let mut stderr = stderr;
        let mut chunk = [0u8; 8192];
        loop {
            match stderr.read(&mut chunk).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&chunk[..n]);
                    let text = text.trim();
                    if !text.is_empty() {
                        tracing::debug!(stderr = %text, "LSP server stderr");
                    }
                }
            }
        }
    });

    BridgeHandle {
        tasks: vec![stdin_task, stdout_task, stderr_task],
    }
}

#[cfg(test)]
mod tests;

// PORT STATUS: packages/core/src/lsp/lsp-proxy.ts (72 lines)
// confidence: high (Content-Length framing is a direct byte-for-byte port)
// todos: 0
// notes: Node stream listeners become tokio pump tasks; `cleanup()` (listener
//   removal) becomes task-abort (also on Drop). The `ws.readyState === 1` guard
//   becomes "outgoing sink still connected". stdin writes route through the
//   manager's shared `stdin_tx` (single ChildStdin writer) rather than a directly
//   owned stream, matching the TS shared `proc.stdin`. Log strings preserved.
