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
//! chunks per worker regardless of file size. Workers are drawn from a
//! process-wide budget, so concurrent loads share about one worker per core
//! and fall back to fewer threads, or the serial reader, when it is spent.

use std::io::{BufRead, Read};
use std::ops::Range;
use std::sync::mpsc::sync_channel;

use serde_json::Value;

use super::budget::{Budget, global};
use super::reader::{CHUNK_SIZE, read_chunks};

/// Largest worker count; parsing stops scaling long before core counts do.
const MAX_THREADS: usize = 8;
/// Workers a background load (a turn-end refresh) may hold; a chat the user
/// opens meanwhile gets the rest of the budget.
const BACKGROUND_THREADS: usize = 2;
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
    /// Where workers come from; shared by all loads in production.
    pub(super) budget: &'static Budget,
    /// File length when known; a file below `min_parallel_bytes` takes no workers.
    pub(super) size_hint: Option<u64>,
    /// Records the most pieces any batch was split into.
    #[cfg(test)]
    pub(super) probe: Option<&'static std::sync::atomic::AtomicUsize>,
}

impl ParseMode {
    #[cfg(test)]
    pub(super) fn serial() -> Self {
        Self {
            threads: 1,
            batch_bytes: CHUNK_SIZE,
            min_parallel_bytes: MIN_PARALLEL_BYTES,
            budget: global(),
            size_hint: None,
            #[cfg(test)]
            probe: None,
        }
    }

    pub(super) fn parallel(threads: usize) -> Self {
        let threads = threads.clamp(1, MAX_THREADS);
        Self {
            threads,
            batch_bytes: threads * CHUNK_SIZE / 2,
            min_parallel_bytes: MIN_PARALLEL_BYTES,
            budget: global(),
            size_hint: None,
            #[cfg(test)]
            probe: None,
        }
    }

    pub(super) fn detect() -> Self {
        Self::parallel(std::thread::available_parallelism().map_or(1, usize::from))
    }

    /// Like [`detect`](Self::detect), capped for work nobody is waiting on.
    pub(super) fn detect_background() -> Self {
        Self::detect().background()
    }

    /// This mode limited to [`BACKGROUND_THREADS`] workers, so work nobody is
    /// waiting on (a turn-end refresh) cannot starve a foreground load.
    pub(super) fn background(self) -> Self {
        if self.threads <= BACKGROUND_THREADS {
            return self;
        }
        Self {
            threads: BACKGROUND_THREADS,
            batch_bytes: BACKGROUND_THREADS * CHUNK_SIZE / 2,
            ..self
        }
    }
}

/// A batch of validated text and its parsed lines, as ranges into the text.
struct Batch {
    text: String,
    lines: Vec<(Range<usize>, Option<Value>)>,
    /// A line that is not UTF-8 ended the read after these lines.
    stopped: bool,
    tail: Tail,
}

enum Tail {
    More,
    End(std::io::Result<()>),
}

/// One worker's share of a batch.
struct Piece {
    lines: Vec<(Range<usize>, Option<Value>)>,
    /// Bytes of the piece before an invalid line.
    valid_len: usize,
    stopped: bool,
}

/// Visits every line with its parsed JSON, in file order. A line that is not
/// valid UTF-8 ends the read, as in [`read_chunks`]. Workers come from
/// `mode.budget`; with fewer than two, or for a small file, the serial reader
/// runs and holds none.
pub(super) fn read_parsed<R: BufRead + Send>(
    reader: R,
    mut mode: ParseMode,
    mut visit: impl FnMut(&str, Option<Value>),
) -> std::io::Result<()> {
    let small = mode
        .size_hint
        .is_some_and(|len| len < mode.min_parallel_bytes as u64);
    let permit = (!small && mode.threads > 1).then(|| mode.budget.take(mode.threads));
    match &permit {
        Some(permit) if permit.workers() >= 2 => mode.threads = permit.workers(),
        _ => {
            drop(permit);
            return read_chunks(reader, |line| {
                visit(line, serde_json::from_slice(line.as_bytes()).ok());
            });
        }
    }
    std::thread::scope(|scope| {
        let (send, receive) = sync_channel::<Batch>(0);
        scope.spawn(move || produce(reader, mode, |batch| send.send(batch).is_ok()));
        for batch in receive {
            for (range, value) in batch.lines {
                visit(&batch.text[range], value);
            }
            if batch.stopped {
                return Ok(());
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
        // The next batch gets a right-sized buffer; growing it by doubling
        // would reserve far more than a batch.
        let mut next = Vec::with_capacity(mode.batch_bytes.max(buf.len() - end));
        next.extend_from_slice(&buf[end..]);
        buf.truncate(end);
        let region = std::mem::replace(&mut buf, next);
        let (text, lines, stopped) = match parse_region(region, tail_is_line, mode) {
            Ok(parsed) => parsed,
            Err(error) => {
                emit(Batch {
                    text: String::new(),
                    lines: Vec::new(),
                    stopped: false,
                    tail: Tail::End(Err(error)),
                });
                return;
            }
        };
        let tail = match read {
            Err(error) => Tail::End(Err(error)),
            Ok(_) if eof => Tail::End(Ok(())),
            Ok(_) => Tail::More,
        };
        let done = stopped || matches!(tail, Tail::End(_));
        let batch = Batch {
            text,
            lines,
            stopped,
            tail,
        };
        if !emit(batch) || done {
            return;
        }
    }
}

type Parsed = (String, Vec<(Range<usize>, Option<Value>)>, bool);

/// Parses a region on the workers and hands its text over without copying.
fn parse_region(
    mut region: Vec<u8>,
    tail_is_line: bool,
    mode: ParseMode,
) -> std::io::Result<Parsed> {
    let ranges = if region.len() < mode.min_parallel_bytes {
        std::iter::once(0..region.len()).collect()
    } else {
        split_aligned(&region, mode.threads)
    };
    #[cfg(test)]
    if let Some(probe) = mode.probe {
        probe.fetch_max(ranges.len(), std::sync::atomic::Ordering::Relaxed);
    }
    let last = ranges.len() - 1;
    let pieces: Vec<Piece> = std::thread::scope(|scope| {
        let bytes = &region;
        let handles: Vec<_> = ranges[..last]
            .iter()
            .map(|range| {
                let range = range.clone();
                scope.spawn(move || parse_piece(&bytes[range.clone()], range.start, false))
            })
            .collect();
        let range = ranges[last].clone();
        let tail = parse_piece(&bytes[range.clone()], range.start, tail_is_line);
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
    });
    let mut lines = Vec::new();
    let mut stopped = false;
    for (piece, range) in pieces.into_iter().zip(&ranges) {
        lines.extend(piece.lines);
        if piece.stopped {
            region.truncate(range.start + piece.valid_len);
            stopped = true;
            break;
        }
    }
    let text = String::from_utf8(region)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    Ok((text, lines, stopped))
}

/// Cuts `region` into at most `parts` ranges that each end after a newline.
fn split_aligned(region: &[u8], parts: usize) -> Vec<Range<usize>> {
    let mut pieces = Vec::with_capacity(parts);
    let mut start = 0;
    for part in 1..parts {
        let target = (region.len() * part / parts).max(start);
        let Some(offset) = region[target..].iter().position(|&b| b == b'\n') else {
            break;
        };
        let cut = target + offset + 1;
        if cut > start {
            pieces.push(start..cut);
            start = cut;
        }
    }
    pieces.push(start..region.len());
    pieces
}

/// Parses the lines of one range that begins at `base` in the batch.
/// `unterminated_last` marks a final line with no newline, which the serial
/// reader passes on without stripping `\r`.
fn parse_piece(piece: &[u8], base: usize, unterminated_last: bool) -> Piece {
    let text = match std::str::from_utf8(piece) {
        Ok(text) => text,
        Err(error) => {
            // Keep the lines before the invalid one; it ends the read (when it
            // is the unterminated tail the read is over anyway).
            let good = &piece[..error.valid_up_to()];
            let line_start = good.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
            let text = std::str::from_utf8(&piece[..line_start]).unwrap_or_default();
            return lines_of(text, base, true, false);
        }
    };
    lines_of(text, base, false, unterminated_last)
}

fn lines_of(text: &str, base: usize, stopped: bool, unterminated_last: bool) -> Piece {
    let mut lines = Vec::new();
    let mut start = 0;
    while start < text.len() {
        let (mut end, next) = match text[start..].find('\n') {
            Some(i) => (start + i, start + i + 1),
            None => (text.len(), text.len()),
        };
        let unterminated = unterminated_last && next == text.len() && !text.ends_with('\n');
        if !unterminated && text[start..end].ends_with('\r') {
            end -= 1;
        }
        let value = serde_json::from_str(&text[start..end]).ok();
        lines.push((base + start..base + end, value));
        start = next;
    }
    Piece {
        lines,
        valid_len: text.len(),
        stopped,
    }
}
