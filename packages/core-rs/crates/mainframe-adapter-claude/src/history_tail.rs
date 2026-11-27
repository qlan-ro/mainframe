//! The newest whole turns of a main transcript, read from the end of the file.
//!
//! A cache miss used to parse the whole transcript before the first window
//! could be answered. The window only needs the last few turns, so the file
//! is read backwards in growing spans until it holds enough of them, the lines
//! from an earlier prompt are run through the same loader as a full read, and
//! the result is cut at a turn start. The full load follows the reply, so
//! nothing that needs the whole history ever sees this list.
//!
//! The loader's state that spans lines must be the same at the cut as in a
//! full read. The read starts at a plain prompt, which sets the turn state the
//! way the full read has it by then; a cut is allowed only when the rest is
//! settled, and every case that cannot be told from the tail returns `None`,
//! so the caller reads the whole file:
//!
//! - other transcripts belong to the session (resumed or branched files);
//! - the file starts with another session's records (copied history);
//! - a line in the read is not UTF-8 (the full read stops there);
//! - a tool result in the window answers a call before it;
//! - an assistant message's prompt group could not be resolved from the tail;
//! - no cut with enough turns exists within a third of the file (at most
//!   [`MAX_READ`]), where the full read is as cheap.
//!
//! Duplicated uuids or API message ids that straddle the cut cannot be seen
//! from the tail. The caller's window marker catches that: the full load
//! compares its own tail with what was shown and resyncs on any difference.

use std::collections::HashSet;
use std::io::{BufRead, Read, Seek, SeekFrom};

use mainframe_adapter_api::{AdapterError, HistoryPage, WindowRequest};
use mainframe_types::chat::ChatMessage;
use serde_json::Value;

use super::*;

#[path = "history_tail_checks.rs"]
mod checks;
use checks::{has_orphan_result, is_anchor, is_compaction_marker, is_turn_start};

/// Bytes of the file's end read first.
const FIRST_READ: u64 = 2 << 20;
/// Longest read from the end, whatever the file's size.
const MAX_READ: u64 = 32 << 20;
/// Reads up to this long are always allowed. Above it a read stops at a third
/// of the file: a window that needs more is no cheaper than the full read.
const MIN_READ: u64 = 4 << 20;
/// Most turns a window may grow to before giving up.
const MAX_TURNS: usize = 256;

/// Messages of the newest turns, oldest first, and whether older ones exist.
#[derive(Debug)]
pub(super) struct Tail {
    pub(super) messages: Vec<ChatMessage>,
    pub(super) older: bool,
}

pub(crate) async fn load_window(
    session_id: &str,
    discovered: &DiscoveredFiles,
    req: WindowRequest<'_>,
) -> Result<Option<HistoryPage>, AdapterError> {
    if !discovered.complete || discovered.parent_files().count() != 1 {
        return Ok(None);
    }
    let mut turns = req.turns.clamp(1, MAX_TURNS);
    loop {
        let (id, path) = (session_id.to_owned(), discovered.primary_path.clone());
        let children = discovered.subagent_files.clone();
        let read =
            run_history_worker(move || read_tail(&path, &id, &children, turns, FIRST_READ)).await?;
        let tail = match read {
            Ok(Some(tail)) => tail,
            Ok(None) => return Ok(None),
            Err(error) => {
                tracing::debug!(error = %error, session_id, "tail read failed, reading the whole file");
                return Ok(None);
            }
        };
        if !tail.older || (req.enough)(&tail.messages) {
            return Ok(Some(HistoryPage {
                messages: tail.messages,
                older: tail.older,
            }));
        }
        if turns >= MAX_TURNS {
            return Ok(None);
        }
        turns = (turns * 2).min(MAX_TURNS);
    }
}

/// The first session id the file names, within its first lines.
fn first_session_id(path: &str) -> std::io::Result<Option<String>> {
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

fn utf8_line(raw: &[u8]) -> Option<&str> {
    let line = std::str::from_utf8(raw).ok()?;
    Some(line.strip_suffix('\r').unwrap_or(line))
}

/// Reads backwards from the end of `path`, starting with `first_read` bytes,
/// until it holds `turns` whole turns after a settled cut. `Ok(None)` when the
/// cut is ambiguous; the caller reads the whole file.
pub(super) fn read_tail(
    path: &str,
    session_id: &str,
    children: &HashSet<String>,
    turns: usize,
    first_read: u64,
) -> std::io::Result<Option<Tail>> {
    let Some(own_session) = first_session_id(path)? else {
        return Ok(None);
    };
    let mut file = std::fs::File::open(path)?;
    let length = file.metadata()?.len();
    let mut span = first_read.max(1);
    // One more prompt than the window: it anchors the read and leaves room for
    // the markers that lead the first turn kept.
    let wanted = turns + 1;
    loop {
        let start = length.saturating_sub(span);
        let mut bytes = vec![0; (length - start) as usize];
        file.seek(SeekFrom::Start(start))?;
        file.read_exact(&mut bytes)?;
        // A read that begins mid-line drops its partial first line.
        let body = match (start, bytes.iter().position(|&byte| byte == b'\n')) {
            (0, _) => Some(0),
            (_, Some(newline)) => Some(newline + 1),
            _ => None,
        };
        let lines: Vec<&[u8]> = body.map_or_else(Vec::new, |from| {
            bytes[from..].split(|&byte| byte == b'\n').collect()
        });
        let anchors = anchors(&lines, session_id, wanted);
        if start > 0 && anchors.len() < wanted {
            let cap = (length / 3).clamp(MIN_READ, MAX_READ);
            if span >= cap {
                return Ok(None);
            }
            span = (span * 4).min(cap);
            continue;
        }
        let whole = start == 0 && anchors.len() < wanted;
        let from = if whole { 0 } else { anchors[wanted - 1] };
        return Ok(settle(
            &lines[from..],
            session_id,
            children,
            if whole {
                None
            } else {
                Some((turns, own_session.as_str()))
            },
        ));
    }
}

/// Indexes of the `wanted` newest anchors in `lines`, newest first.
fn anchors(lines: &[&[u8]], session_id: &str, wanted: usize) -> Vec<usize> {
    let mut found = Vec::new();
    for (index, raw) in lines.iter().enumerate().rev() {
        if found.len() == wanted {
            break;
        }
        let Some(line) = utf8_line(raw) else { continue };
        // Cheap and conservative: a missed anchor only moves the cut earlier.
        if !line.contains("\"user\"") || line.contains("\"tool_result\"") {
            continue;
        }
        if serde_json::from_str::<Value>(line).is_ok_and(|entry| is_anchor(&entry, session_id)) {
            found.push(index);
        }
    }
    found
}

/// Runs `lines` through the loader. With `cut` (the turns to keep and the
/// file's own session id) the list is cut to the newest turns and checked;
/// without it the lines are the whole file.
fn settle(
    lines: &[&[u8]],
    session_id: &str,
    children: &HashSet<String>,
    cut: Option<(usize, &str)>,
) -> Option<Tail> {
    let mut load = HistoryLoad::default();
    let mut facts = history_agent_facts::AgentFacts::default();
    for raw in lines {
        let line = match utf8_line(raw) {
            Some(line) => line,
            // The full read ends at this line; where that leaves the window cannot be told.
            None if cut.is_some() => return None,
            None => break,
        };
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some((_, own)) = cut
            && entry
                .get("sessionId")
                .and_then(Value::as_str)
                .is_some_and(|id| id != own)
        {
            return None;
        }
        facts.observe(&entry);
        load.entry(&entry, session_id, false);
    }
    let kept = match cut {
        None => 0,
        Some((turns, _)) => {
            let starts: Vec<usize> = (0..load.messages.len())
                .filter(|&index| is_turn_start(&load.messages[index]))
                .collect();
            let mut kept = *starts.get(starts.len().checked_sub(turns)?)?;
            while kept > 0 && is_compaction_marker(&load.messages[kept - 1]) {
                kept -= 1;
            }
            if load.prompt_groups.chains_leave_records(kept) {
                return None;
            }
            kept
        }
    };
    let agent_ids = std::mem::take(&mut load.agent_id_to_parent_tool_use_id);
    let mut rows = load.finish();
    facts.apply(&mut rows, &agent_ids, children);
    let rows = rows.split_off(kept);
    if cut.is_some() && has_orphan_result(&rows) {
        return None;
    }
    Some(Tail {
        messages: rows,
        older: cut.is_some(),
    })
}

#[cfg(test)]
#[path = "history_tail_fallback_tests.rs"]
mod fallback_tests;
#[cfg(test)]
#[path = "history_tail_fixture.rs"]
mod fixture;
#[cfg(test)]
#[path = "history_tail_perf_tests.rs"]
mod perf_tests;
#[cfg(test)]
#[path = "history_tail_tests.rs"]
mod tests;
