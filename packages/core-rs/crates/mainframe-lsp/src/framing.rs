//! LSP base-protocol framing: each JSON-RPC message on the child's stdio is
//! preceded by a `Content-Length` header counting the payload's UTF-8 bytes.

const HEADER_SEPARATOR: &[u8] = b"\r\n\r\n";

/// One message framed for the child's stdin.
pub(crate) fn encode(json: &str) -> Vec<u8> {
    let mut frame = format!("Content-Length: {}\r\n\r\n", json.len()).into_bytes();
    frame.extend_from_slice(json.as_bytes());
    frame
}

/// The `Content-Length` value of a header block. Field names are
/// case-insensitive, and other fields (such as `Content-Type`) are ignored.
fn content_length(header: &[u8]) -> Option<usize> {
    String::from_utf8_lossy(header)
        .split("\r\n")
        .find_map(|field| {
            let (name, value) = field.split_once(':')?;
            if name.trim().eq_ignore_ascii_case("content-length") {
                value.trim().parse().ok()
            } else {
                None
            }
        })
}

/// Incremental decoder for the child's stdout.
#[derive(Default)]
pub(crate) struct FrameParser {
    buffer: Vec<u8>,
}

impl FrameParser {
    /// Appends `chunk` and returns every message it completed.
    pub(crate) fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(chunk);
        let mut messages = Vec::new();
        while let Some(header_end) = self
            .buffer
            .windows(HEADER_SEPARATOR.len())
            .position(|window| window == HEADER_SEPARATOR)
        {
            let content_start = header_end + HEADER_SEPARATOR.len();
            let Some(content_end) = content_length(&self.buffer[..header_end])
                .and_then(|length| content_start.checked_add(length))
            else {
                tracing::warn!(
                    header = %String::from_utf8_lossy(&self.buffer[..header_end]),
                    "malformed LSP header, discarding"
                );
                self.buffer.drain(..content_start);
                continue;
            };
            if self.buffer.len() < content_end {
                break;
            }
            messages.push(
                String::from_utf8_lossy(&self.buffer[content_start..content_end]).into_owned(),
            );
            self.buffer.drain(..content_end);
        }
        messages
    }
}

#[cfg(test)]
#[path = "framing_tests.rs"]
mod tests;
