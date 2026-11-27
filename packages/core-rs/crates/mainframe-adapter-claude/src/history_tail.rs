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
//! - a line in the read is not UTF-8 (the full read stops there; one before
//!   where the read began is not seen, and the window marker catches it);
//! - a user or assistant record has no uuid or timestamp (the loader invents
//!   a different one on each read);
//! - a tool result in the window answers a call before it, or a task update
//!   without a subject names a task its window never created (the display
//!   fills the subject from the creating call);
//! - an assistant message's prompt group could not be resolved from the tail;
//! - the file is shorter than [`MIN_FILE`], holds too few prompts, or needs
//!   more than a third of itself (at most [`MAX_READ`]) for the window, where
//!   the full read is as cheap.
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
use checks::{
    has_orphan_result, has_unresolved_task_update, is_anchor, is_compaction_marker, is_turn_start,
    lacks_identity,
};

/// Bytes of the file's end read first.
const FIRST_READ: u64 = 2 << 20;
/// Longest read from the end, whatever the file's size.
const MAX_READ: u64 = 32 << 20;
/// Reads up to this long are always allowed. Above it a read stops at a third
/// of the file: a window that needs more is no cheaper than the full read.
const MIN_READ: u64 = 4 << 20;
/// Files shorter than this are read in full: the parallel full read is as
/// fast as any read from the end.
const MIN_FILE: u64 = 8 << 20;
/// Most turns a window may grow to before giving up.
const MAX_TURNS: usize = 64;
/// Most reads a window may take, each asking for twice the turns of the last.
const MAX_ATTEMPTS: usize = 3;

pub(crate) async fn load_window(
    session_id: &str,
    discovered: &DiscoveredFiles,
    req: WindowRequest<'_>,
) -> Result<Option<HistoryPage>, AdapterError> {
    load_window_within(session_id, discovered, req, Limits::PRODUCTION).await
}

async fn load_window_within(
    session_id: &str,
    discovered: &DiscoveredFiles,
    req: WindowRequest<'_>,
    limits: Limits,
) -> Result<Option<HistoryPage>, AdapterError> {
    if !discovered.complete || discovered.parent_files().count() != 1 {
        return Ok(None);
    }
    let mut turns = req.turns.clamp(1, MAX_TURNS);
    for _ in 0..MAX_ATTEMPTS {
        let (id, path) = (session_id.to_owned(), discovered.primary_path.clone());
        let children = discovered.subagent_files.clone();
        let read =
            run_history_worker(move || read_tail(&path, &id, &children, turns, limits)).await?;
        let messages = match read {
            Ok(Some(messages)) => messages,
            Ok(None) => return Ok(None),
            Err(error) => {
                tracing::debug!(error = %error, session_id, "tail read failed, reading the whole file");
                return Ok(None);
            }
        };
        if (req.enough)(&messages) {
            return Ok(Some(HistoryPage {
                messages,
                older: true,
            }));
        }
        if turns >= MAX_TURNS {
            break;
        }
        turns = (turns * 2).min(MAX_TURNS);
    }
    Ok(None)
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

/// How much of the file a tail read may take.
#[derive(Clone, Copy)]
pub(super) struct Limits {
    /// Bytes of the file's end read first.
    pub(super) first_read: u64,
    /// Files shorter than this are not read from the end.
    pub(super) min_file: u64,
}

impl Limits {
    const PRODUCTION: Self = Self {
        first_read: FIRST_READ,
        min_file: MIN_FILE,
    };
}

/// Reads backwards from the end of `path` until it holds `turns` whole turns
/// after a settled cut. `Ok(None)` when the cut is ambiguous or the file is
/// too short or too thin in prompts to gain anything; the caller reads the
/// whole file.
pub(super) fn read_tail(
    path: &str,
    session_id: &str,
    children: &HashSet<String>,
    turns: usize,
    limits: Limits,
) -> std::io::Result<Option<Vec<ChatMessage>>> {
    let mut file = std::fs::File::open(path)?;
    let length = file.metadata()?.len();
    if length < limits.min_file {
        return Ok(None);
    }
    let Some(own_session) = first_session_id(path)? else {
        return Ok(None);
    };
    // One more prompt than the window: it anchors the read and leaves room for
    // the markers that lead the first turn kept.
    let wanted = turns + 1;
    let cap = (length / 3).clamp(MIN_READ, MAX_READ);
    // The bytes from `start` to the end, kept across growth steps.
    let mut bytes: Vec<u8> = Vec::new();
    let mut start = length;
    let mut span = limits.first_read.max(1);
    loop {
        let from = length.saturating_sub(span);
        let mut earlier = vec![0; (start - from) as usize];
        file.seek(SeekFrom::Start(from))?;
        file.read_exact(&mut earlier)?;
        earlier.extend_from_slice(&bytes);
        (bytes, start) = (earlier, from);
        // A read that begins mid-line drops its partial first line.
        let body = match (start, bytes.iter().position(|&byte| byte == b'\n')) {
            (0, _) => Some(0),
            (_, Some(newline)) => Some(newline + 1),
            _ => None,
        };
        let lines: Vec<&[u8]> = body.map_or_else(Vec::new, |first| {
            bytes[first..].split(|&byte| byte == b'\n').collect()
        });
        let anchors = anchors(&lines, session_id, wanted);
        if anchors.len() >= wanted {
            return Ok(settle(
                &lines[anchors[wanted - 1]..],
                session_id,
                children,
                turns,
                &own_session,
            ));
        }
        // Too few prompts in the whole file, or the window outgrew what a
        // read from the end can save over the full read.
        if start == 0 || span >= cap {
            return Ok(None);
        }
        span = (span * 4).min(cap);
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

/// Runs `lines` through the loader, cuts the list to its newest `turns` turns
/// and checks that the cut can be trusted.
fn settle(
    lines: &[&[u8]],
    session_id: &str,
    children: &HashSet<String>,
    turns: usize,
    own_session: &str,
) -> Option<Vec<ChatMessage>> {
    let mut load = HistoryLoad::default();
    let mut facts = history_agent_facts::AgentFacts::default();
    for raw in lines {
        // The full read ends at a line that is not UTF-8; where that leaves
        // the window cannot be told.
        let Ok(entry) = serde_json::from_str::<Value>(utf8_line(raw)?) else {
            continue;
        };
        let foreign = entry
            .get("sessionId")
            .and_then(Value::as_str)
            .is_some_and(|id| id != own_session);
        if foreign || lacks_identity(&entry) {
            return None;
        }
        facts.observe(&entry);
        load.entry(&entry, session_id, false);
    }
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
    let agent_ids = std::mem::take(&mut load.agent_id_to_parent_tool_use_id);
    let mut rows = load.finish();
    facts.apply(&mut rows, &agent_ids, children);
    let rows = rows.split_off(kept);
    if has_orphan_result(&rows) || has_unresolved_task_update(&rows) {
        return None;
    }
    Some(rows)
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
