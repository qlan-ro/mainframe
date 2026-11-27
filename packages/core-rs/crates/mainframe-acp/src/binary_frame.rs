//! The binary WebSocket frame that carries one compressed batch of a history
//! response, for a connection that opted into `binaryHistoryFrames`.
//!
//! The JSON-RPC response arrives as a text frame with `batchFrames: N` in
//! place of `batches`; the N batches follow (or precede it, the client
//! tolerates either) as binary frames, each tied to the response by its
//! request id:
//!
//! ```text
//! offset  size  field
//! 0       1     version (1)
//! 1       1     encoding (1 = zlib-deflated JSON array of session/update)
//! 2       2     index of this frame in the response, big-endian
//! 4       2     total frames in the response, big-endian
//! 6       2     updates in this frame, big-endian
//! 8       2     request id length in bytes, big-endian
//! 10      n     request id, UTF-8 (a number as its decimal string)
//! 10 + n  ..    the compressed bytes, to the end of the frame
//! ```

use mainframe_types::acp::extensions::BatchFrame;
use mainframe_types::acp::jsonrpc::RequestId;

pub const FRAME_VERSION: u8 = 1;
pub const ENCODING_ZLIB: u8 = 1;
const FIXED_HEADER_LEN: usize = 10;

/// The string a request id travels as in a frame header.
pub fn id_text(id: &RequestId) -> String {
    match id {
        RequestId::Number(number) => number.to_string(),
        RequestId::String(text) => text.clone(),
    }
}

/// Frame `batch` as number `index` of `total` for the response to `id`.
/// `None` when a field does not fit the header (an id over 65535 bytes, or
/// more than 65535 frames or updates), which the caller reports as an error.
pub fn encode_frame(id: &str, index: usize, total: usize, batch: &BatchFrame) -> Option<Vec<u8>> {
    let field = |value: usize| u16::try_from(value).ok().map(u16::to_be_bytes);
    let mut frame = Vec::with_capacity(FIXED_HEADER_LEN + id.len() + batch.bytes.len());
    frame.extend([FRAME_VERSION, ENCODING_ZLIB]);
    frame.extend(field(index)?);
    frame.extend(field(total)?);
    frame.extend(field(batch.count)?);
    frame.extend(field(id.len())?);
    frame.extend(id.as_bytes());
    frame.extend(&batch.bytes);
    Some(frame)
}

/// The fields of a frame header, for tests and diagnostics.
#[derive(Debug, PartialEq, Eq)]
pub struct DecodedFrame<'a> {
    pub id: &'a str,
    pub index: usize,
    pub total: usize,
    pub count: usize,
    pub payload: &'a [u8],
}

/// Read a frame back; `None` for a short, unknown-version or malformed one.
pub fn decode_frame(frame: &[u8]) -> Option<DecodedFrame<'_>> {
    let header = frame.get(..FIXED_HEADER_LEN)?;
    if header[0] != FRAME_VERSION || header[1] != ENCODING_ZLIB {
        return None;
    }
    let word = |at: usize| usize::from(u16::from_be_bytes([header[at], header[at + 1]]));
    let id_end = FIXED_HEADER_LEN + word(8);
    let id = std::str::from_utf8(frame.get(FIXED_HEADER_LEN..id_end)?).ok()?;
    Some(DecodedFrame {
        id,
        index: word(2),
        total: word(4),
        count: word(6),
        payload: &frame[id_end..],
    })
}

#[cfg(test)]
#[path = "binary_frame_tests.rs"]
mod tests;
