//! Line-at-a-time rollout reading for the PR-scan path. Replaces
//! `tokio::fs::read_to_string` (which allocated the whole rollout as one
//! string) with a bounded `BufRead` walk: memory is the read buffer plus the
//! longest line, not the file size.

use std::io::{self, BufRead, ErrorKind};
use std::ops::ControlFlow;

/// Read buffer size for rollout files (matches the Claude history reader).
pub(crate) const CHUNK_SIZE: usize = 1024 * 1024;

/// Calls `visit` for every line, with the same splitting as `str::lines`
/// (`\n` or `\r\n` terminators, a missing final terminator is allowed, an
/// empty line is visited as `""`). Invalid UTF-8 is an `InvalidData` error,
/// which is what `read_to_string` reported for the same bytes. Stops early
/// when `visit` returns `Break`.
pub(crate) fn visit_lines(
    mut reader: impl BufRead,
    mut visit: impl FnMut(&str) -> ControlFlow<()>,
) -> io::Result<()> {
    let mut buf = Vec::new();
    loop {
        buf.clear();
        if reader.read_until(b'\n', &mut buf)? == 0 {
            return Ok(());
        }
        if buf.last() == Some(&b'\n') {
            buf.pop();
            if buf.last() == Some(&b'\r') {
                buf.pop();
            }
        }
        let line =
            std::str::from_utf8(&buf).map_err(|err| io::Error::new(ErrorKind::InvalidData, err))?;
        if visit(line).is_break() {
            return Ok(());
        }
        if buf.capacity() > CHUNK_SIZE {
            buf = Vec::new();
        }
    }
}
