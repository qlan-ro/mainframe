//! Parallel JSON parsing for the main transcript reader.
//!
//! The file is read in batches. Each batch is cut into line-aligned byte
//! ranges, one per worker; workers validate and parse their lines
//! concurrently, and the caller receives every line in file order on the
//! calling thread. Stateful handling (dedupe, tool-result joins, ordering)
//! stays serial in the caller, so results match the serial reader exactly.
//! A producer thread reads and parses the next batch while the caller handles
//! the current one; the hand-off is a rendezvous, so at most two batches of
//! text and parsed values are alive at once, which bounds memory to a few
//! chunks per worker regardless of file size.

use std::io::{BufRead, Read};
use std::ops::Range;
use std::sync::mpsc::sync_channel;

use serde_json::Value;

use super::reader::{CHUNK_SIZE, read_chunks};

/// Largest worker count; parsing stops scaling long before core counts do.
const MAX_THREADS: usize = 8;
/// Batches below this size are parsed inline: thread start-up would dominate.
const MIN_PARALLEL_BYTES: usize = 256 * 1024;

#[derive(Clone, Copy, Debug)]
pub(super) struct ParseMode {
    /// Worker count; 1 selects the serial reader.
    pub(super) threads: usize,
    /// Bytes read before the batch is split across workers.
    pub(super) batch_bytes: usize,
    /// Batches smaller than this are parsed inline.
    pub(super) min_parallel_bytes: usize,
}

impl ParseMode {
    #[cfg(test)]
    pub(super) fn serial() -> Self {
        Self {
            threads: 1,
            batch_bytes: CHUNK_SIZE,
            min_parallel_bytes: MIN_PARALLEL_BYTES,
        }
    }

    pub(super) fn parallel(threads: usize) -> Self {
        let threads = threads.clamp(1, MAX_THREADS);
        Self {
            threads,
            batch_bytes: threads * CHUNK_SIZE / 2,
            min_parallel_bytes: MIN_PARALLEL_BYTES,
        }
    }

    pub(super) fn detect() -> Self {
        Self::parallel(std::thread::available_parallelism().map_or(1, usize::from))
    }
}

/// One worker's share of a batch: the validated text and its parsed lines.
struct Piece {
    text: String,
    lines: Vec<(Range<usize>, Option<Value>)>,
    /// A line that is not UTF-8 ended the piece; nothing after it is read.
    stopped: bool,
}

enum Tail {
    More,
    End(std::io::Result<()>),
}

struct Batch {
    pieces: Vec<Piece>,
    tail: Tail,
}

/// Visits every line with its parsed JSON, in file order. A line that is not
/// valid UTF-8 ends the read, as in [`read_chunks`].
pub(super) fn read_parsed<R: BufRead + Send>(
    reader: R,
    mode: ParseMode,
    mut visit: impl FnMut(&str, Option<Value>),
) -> std::io::Result<()> {
    if mode.threads <= 1 {
        return read_chunks(reader, |line| {
            visit(line, serde_json::from_slice(line.as_bytes()).ok());
        });
    }
    std::thread::scope(|scope| {
        let (send, receive) = sync_channel::<Batch>(0);
        scope.spawn(move || produce(reader, mode, |batch| send.send(batch).is_ok()));
        for batch in receive {
            for piece in batch.pieces {
                for (range, value) in piece.lines {
                    visit(&piece.text[range], value);
                }
                if piece.stopped {
                    return Ok(());
                }
            }
            if let Tail::End(result) = batch.tail {
                return result;
            }
        }
        Ok(())
    })
}

/// Reads batches and hands each to `emit` until the end of input, a read
/// error, an invalid line, or `emit` returning false.
fn produce<R: BufRead>(mut reader: R, mode: ParseMode, emit: impl Fn(Batch) -> bool) {
    let mut buf: Vec<u8> = Vec::new();
    loop {
        let want = mode
            .batch_bytes
            .saturating_sub(buf.len())
            .max(mode.batch_bytes.min(CHUNK_SIZE));
        let read = reader.by_ref().take(want as u64).read_to_end(&mut buf);
        let eof = matches!(read, Ok(n) if n < want);
        let complete = buf.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
        let (end, tail_is_line) = match &read {
            Ok(_) if eof => (buf.len(), true),
            Ok(_) if complete == 0 => continue, // one line longer than the batch
            // After a failed read only complete lines are visited, like the
            // serial reader; the unterminated tail is dropped.
            _ => (complete, false),
        };
        let pieces = parse_region(&buf[..end], tail_is_line, mode);
        let stopped = pieces.last().is_some_and(|piece| piece.stopped);
        let tail = match read {
            Err(error) => Tail::End(Err(error)),
            Ok(_) if eof => Tail::End(Ok(())),
            Ok(_) => Tail::More,
        };
        let done = stopped || matches!(tail, Tail::End(_));
        if !emit(Batch { pieces, tail }) || done {
            return;
        }
        buf.drain(..end);
    }
}

fn parse_region(region: &[u8], tail_is_line: bool, mode: ParseMode) -> Vec<Piece> {
    let ranges = if region.len() < mode.min_parallel_bytes {
        vec![region]
    } else {
        split_aligned(region, mode.threads)
    };
    let last = ranges.len() - 1;
    std::thread::scope(|scope| {
        let handles: Vec<_> = ranges[..last]
            .iter()
            .map(|range| scope.spawn(move || parse_piece(range, false)))
            .collect();
        let tail = parse_piece(ranges[last], tail_is_line);
        let mut pieces: Vec<_> = handles
            .into_iter()
            .map(|handle| {
                handle
                    .join()
                    .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
            })
            .collect();
        pieces.push(tail);
        pieces
    })
}

/// Cuts `region` into at most `parts` ranges that each end after a newline.
fn split_aligned(region: &[u8], parts: usize) -> Vec<&[u8]> {
    let mut pieces = Vec::with_capacity(parts);
    let mut start = 0;
    for part in 1..parts {
        let target = (region.len() * part / parts).max(start);
        let Some(offset) = region[target..].iter().position(|&b| b == b'\n') else {
            break;
        };
        let cut = target + offset + 1;
        if cut > start {
            pieces.push(&region[start..cut]);
            start = cut;
        }
    }
    pieces.push(&region[start..]);
    pieces
}

/// Parses the lines of one range. `unterminated_last` marks a final line with
/// no newline, which the serial reader passes on without stripping `\r`.
fn parse_piece(piece: &[u8], unterminated_last: bool) -> Piece {
    let (valid, stopped) = match std::str::from_utf8(piece) {
        Ok(text) => (text, false),
        Err(error) => {
            // Keep the lines before the invalid one. The invalid line ends the
            // read, unless it is the unterminated tail, which is just skipped.
            let good = &piece[..error.valid_up_to()];
            let line_start = good.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
            let is_tail = unterminated_last && !piece[line_start..].contains(&b'\n');
            let text = std::str::from_utf8(&piece[..line_start]).unwrap_or_default();
            return finish(text, !is_tail, false);
        }
    };
    finish(valid, stopped, unterminated_last)
}

fn finish(text: &str, stopped: bool, unterminated_last: bool) -> Piece {
    let mut lines = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let (mut end, next) = match text[start..].find('\n') {
            Some(i) => (start + i, start + i + 1),
            None => (text.len(), text.len()),
        };
        let unterminated = next == text.len() && !text.ends_with('\n') && unterminated_last;
        if !unterminated && text[start..end].ends_with('\r') {
            end -= 1;
        }
        let value = serde_json::from_str(&text[start..end]).ok();
        lines.push((start..end, value));
        start = next;
    }
    Piece {
        text: text.to_owned(),
        lines,
        stopped,
    }
}
