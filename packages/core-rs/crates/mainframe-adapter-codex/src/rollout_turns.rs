use crate::rollout_fork::ForkStartScan;
use crate::rollout_reader::{RolloutReaderDeps, parse_response_items, resolve_rollout_path};
use crate::rollout_stream::{CHUNK_SIZE, visit_lines};
use crate::types::{ThreadItem, ThreadReadTurn};
use mainframe_adapter_api::pr_detection::is_scan_relevant;
use mainframe_types::chat::ChatMessage;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::ops::ControlFlow;
use std::path::Path;

/// Rebuilds the PR-scan-relevant messages of a chat from its rollout.
/// The file is streamed, never held whole: only the response items of the
/// turn being read stay in memory, and after each turn only the messages
/// `is_scan_relevant` accepts are kept.
///
/// `None` means there is no usable rollout (missing, unreadable, or it
/// converts to no messages at all), so the caller may fall back to
/// `thread/read`. `Some` with an empty list means the rollout was read and
/// holds no PR links; the caller must not fall back.
pub(crate) async fn read_rollout_history(
    path: &str,
    thread: &str,
    deps: Option<&RolloutReaderDeps>,
) -> Option<Vec<ChatMessage>> {
    let path = resolve_rollout_path(path, Some(thread), deps).await?;
    let thread = thread.to_owned();
    let scanned = tokio::task::spawn_blocking(move || convert_rollout_file(&path, &thread))
        .await
        .ok()??;
    (scanned.total > 0).then_some(scanned.messages)
}

/// The messages kept from a rollout, and how many it converted to in all.
struct Scanned {
    messages: Vec<ChatMessage>,
    total: usize,
}

fn open(path: &Path) -> std::io::Result<BufReader<std::fs::File>> {
    Ok(BufReader::with_capacity(
        CHUNK_SIZE,
        std::fs::File::open(path)?,
    ))
}

/// `None` when the file cannot be read, including invalid UTF-8 anywhere in it.
fn convert_rollout_file(path: &Path, thread: &str) -> Option<Scanned> {
    let start = forked_start(open(path).ok()?)?;
    convert_rollout_stream(open(path).ok()?, thread, start, &is_scan_relevant).ok()
}

/// First pass: only a forked child needs it, and it stops at the handoff line.
/// A plain rollout costs one line.
fn forked_start(reader: impl BufRead) -> Option<usize> {
    let mut scan = ForkStartScan::default();
    visit_lines(reader, |line| scan.push(line)).ok()?;
    Some(scan.start.unwrap_or(0))
}

/// One streamed pass with the grouping of the old whole-string version. A group
/// is flushed when the next turn starts or the file ends, so its pending
/// tool-call maps and `has_users` see exactly the same lines as before. Lines
/// that cannot produce items (neither a `response_item` nor a `user_message`
/// event) are not kept. Of the converted messages only those `keep` accepts
/// are retained, as each group is flushed.
fn convert_rollout_stream(
    reader: impl BufRead,
    thread: &str,
    start: usize,
    keep: &dyn Fn(&ChatMessage) -> bool,
) -> std::io::Result<Scanned> {
    let mut groups = Groups::new(thread, keep);
    let mut index = 0usize;
    visit_lines(reader, |line| {
        index += 1;
        if index > start {
            groups.line(line);
        }
        ControlFlow::Continue(())
    })?;
    groups.flush("inProgress");
    Ok(Scanned {
        messages: groups.out,
        total: groups.total,
    })
}

struct Groups<'a> {
    thread: &'a str,
    keep: &'a dyn Fn(&ChatMessage) -> bool,
    out: Vec<ChatMessage>,
    total: usize,
    counter: usize,
    kept: Vec<String>,
    turn: Option<String>,
    has_users: bool,
}

impl<'a> Groups<'a> {
    fn new(thread: &'a str, keep: &'a dyn Fn(&ChatMessage) -> bool) -> Self {
        Self {
            thread,
            keep,
            out: Vec::new(),
            total: 0,
            counter: 0,
            kept: Vec::new(),
            turn: None,
            has_users: false,
        }
    }

    /// Converts the kept lines as one group and starts the next.
    fn flush(&mut self, status: &str) {
        let lines: Vec<&str> = self.kept.iter().map(String::as_str).collect();
        let items = parse_response_items(&lines, &mut self.counter, self.has_users);
        let messages = convert_group(items, self.turn.take(), status, self.thread);
        self.total += messages.len();
        self.out
            .extend(messages.into_iter().filter(|m| (self.keep)(m)));
        self.kept.clear();
        self.has_users = false;
    }

    fn line(&mut self, line: &str) {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let payload = &record["payload"];
        match (record["type"].as_str(), payload["type"].as_str()) {
            (Some("response_item"), _) => self.kept.push(line.to_owned()),
            (Some("event_msg"), Some("task_started" | "turn_started")) => {
                self.flush("inProgress");
                self.turn = payload["turn_id"].as_str().map(str::to_owned);
            }
            (Some("event_msg"), Some("user_message")) => {
                self.has_users = true;
                self.kept.push(line.to_owned());
            }
            (Some("event_msg"), Some("task_complete" | "turn_complete" | "turn_aborted"))
                if self
                    .turn
                    .as_deref()
                    .is_some_and(|id| payload["turn_id"] == id) =>
            {
                let aborted = payload["type"] == "turn_aborted";
                self.flush(if aborted { "interrupted" } else { "completed" });
            }
            _ => {}
        }
    }
}

fn convert_group(
    items: Vec<ThreadItem>,
    turn: Option<String>,
    status: &str,
    thread: &str,
) -> Vec<ChatMessage> {
    let children = HashMap::new();
    let agents = HashMap::new();
    match turn {
        Some(id) => crate::presentation_history::convert_turns(
            &[ThreadReadTurn {
                id,
                status: status.into(),
                items,
                timing: Default::default(),
            }],
            thread,
            &children,
            &agents,
        ),
        None => crate::history_convert::convert_thread_items(&items, thread, &children, &agents),
    }
}

#[cfg(test)]
#[path = "rollout_turns_tests.rs"]
mod tests;
