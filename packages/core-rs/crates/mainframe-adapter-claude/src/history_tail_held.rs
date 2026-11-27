//! The bytes a tail read holds, and the limits it works within.
use std::io::{BufRead, Read, Seek, SeekFrom};

use serde_json::Value;

use super::{FIRST_READ, MIN_FILE};

/// How much of the file a tail read may take.
#[derive(Clone, Copy)]
pub(crate) struct Limits {
    /// Bytes of the file's end read first.
    pub(super) first_read: u64,
    /// Files shorter than this are not read from the end.
    pub(super) min_file: u64,
}

impl Limits {
    pub(super) const PRODUCTION: Self = Self {
        first_read: FIRST_READ,
        min_file: MIN_FILE,
    };
}

/// The end of a transcript, kept across the reads of one window request so a
/// longer attempt does not read the same bytes again.
#[derive(Default)]
pub(crate) struct Held {
    /// File length when read; a different length discards the bytes.
    length: u64,
    /// Where `bytes` begin in the file; they run to `length`.
    pub(super) start: u64,
    pub(super) bytes: Vec<u8>,
}

impl Held {
    /// Starts over unless the file is unchanged; the span already held.
    pub(super) fn begin(&mut self, length: u64) -> u64 {
        if self.length != length || self.bytes.is_empty() {
            *self = Self {
                length,
                start: length,
                bytes: Vec::new(),
            };
        }
        length - self.start
    }

    /// Reads the file's last `span` bytes, keeping what is already held.
    pub(super) fn extend_to(
        &mut self,
        file: &mut std::fs::File,
        length: u64,
        span: u64,
    ) -> std::io::Result<()> {
        let from = length.saturating_sub(span);
        if from < self.start {
            let mut earlier = vec![0; (self.start - from) as usize];
            file.seek(SeekFrom::Start(from))?;
            file.read_exact(&mut earlier)?;
            earlier.extend_from_slice(&self.bytes);
            (self.bytes, self.start) = (earlier, from);
        }
        Ok(())
    }

    /// The held lines. A read that begins mid-line drops its partial first line.
    pub(super) fn lines(&self) -> Vec<&[u8]> {
        let first = match (
            self.start,
            self.bytes.iter().position(|&byte| byte == b'\n'),
        ) {
            (0, _) => 0,
            (_, Some(newline)) => newline + 1,
            _ => return Vec::new(),
        };
        self.bytes[first..].split(|&byte| byte == b'\n').collect()
    }
}

/// The first session id the file names, within its first lines.
pub(super) fn first_session_id(path: &str) -> std::io::Result<Option<String>> {
    let mut reader = std::io::BufReader::new(std::fs::File::open(path)?);
    let mut line = Vec::new();
    for _ in 0..32 {
        line.clear();
        if (&mut reader).take(1 << 20).read_until(b'\n', &mut line)? == 0 {
            break;
        }
        if let Ok(entry) = serde_json::from_slice::<Value>(&line)
            && let Some(id) = entry.get("sessionId").and_then(Value::as_str)
        {
            return Ok(Some(id.to_owned()));
        }
    }
    Ok(None)
}

pub(super) fn utf8_line(raw: &[u8]) -> Option<&str> {
    let line = std::str::from_utf8(raw).ok()?;
    Some(line.strip_suffix('\r').unwrap_or(line))
}
