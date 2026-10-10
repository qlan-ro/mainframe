//! Messages Mainframe holds for a busy chat and sends, batched into one user
//! message, once that chat is idle. Unlike the CLI's own queue this never
//! folds into a running turn, works the same on every adapter, and can drop
//! entries when a chat is stopped. In memory only: a `queue` send's caller
//! turn dies with the daemon too. Every change is reported per target, so the
//! target's `Chat.agent_outbox` stays current.

use mainframe_types::sync::LockExt as _;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::errors::cap_chars;

const PREVIEW_CHARS: usize = 120;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutboxKind {
    /// A `chat_send` in `queue` (or busy `auto`) mode.
    Send,
    /// A delegated task's completion owed to its parent.
    TaskResult { task_id: String },
    /// An infrastructure notice (e.g. a queued `Send` dropped at delivery
    /// time), never subject to the ceiling re-check: it reports on a `Send`,
    /// it is not one.
    Notice,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboxEntry {
    pub entry_id: String,
    pub target_chat_id: String,
    pub from_chat_id: String,
    pub kind: OutboxKind,
    /// The full message text, marker included.
    pub body: String,
    pub preview: String,
}

type Listener = Box<dyn Fn(&str) + Send + Sync>;

#[derive(Default)]
pub struct Outbox {
    entries: Mutex<Vec<OutboxEntry>>,
    next_id: AtomicU64,
    /// Told each target whose held entries changed, after the lock drops (the
    /// listener reads the outbox back).
    listener: Option<Listener>,
}

impl Outbox {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn observed(listener: impl Fn(&str) + Send + Sync + 'static) -> Self {
        Self {
            listener: Some(Box::new(listener)),
            ..Self::default()
        }
    }

    fn changed<'a>(&self, targets: impl IntoIterator<Item = &'a str>) {
        let Some(listener) = &self.listener else {
            return;
        };
        let mut seen: Vec<&str> = Vec::new();
        for target in targets {
            if !seen.contains(&target) {
                seen.push(target);
                listener(target);
            }
        }
    }

    /// Holds `body` for `target`; returns the entry id. `preview` is the
    /// unwrapped text, cut for display.
    pub fn push(
        &self,
        target: &str,
        from: &str,
        kind: OutboxKind,
        body: String,
        preview: &str,
    ) -> String {
        let entry_id = format!("ob{}", self.next_id.fetch_add(1, Ordering::SeqCst) + 1);
        self.lock().push(OutboxEntry {
            entry_id: entry_id.clone(),
            target_chat_id: target.to_string(),
            from_chat_id: from.to_string(),
            kind,
            body,
            preview: cap_chars(preview, PREVIEW_CHARS),
        });
        self.changed([target]);
        entry_id
    }

    #[must_use]
    pub(crate) fn has_for(&self, target: &str) -> bool {
        self.lock().iter().any(|e| e.target_chat_id == target)
    }

    #[must_use]
    pub fn targets(&self) -> Vec<String> {
        let mut targets: Vec<String> = self
            .lock()
            .iter()
            .map(|e| e.target_chat_id.clone())
            .collect();
        targets.sort();
        targets.dedup();
        targets
    }

    #[must_use]
    pub(crate) fn list_for(&self, target: &str) -> Vec<OutboxEntry> {
        self.lock()
            .iter()
            .filter(|e| e.target_chat_id == target)
            .cloned()
            .collect()
    }

    /// Removes and returns every entry owed to `target`, oldest first.
    pub(crate) fn take_for(&self, target: &str) -> Vec<OutboxEntry> {
        let taken = {
            let mut entries = self.lock();
            let (taken, kept): (Vec<_>, Vec<_>) =
                entries.drain(..).partition(|e| e.target_chat_id == target);
            *entries = kept;
            taken
        };
        if !taken.is_empty() {
            self.changed([target]);
        }
        taken
    }

    /// Puts entries back at the front, after a failed delivery.
    pub fn restore(&self, mut taken: Vec<OutboxEntry>) {
        let targets: Vec<String> = taken.iter().map(|e| e.target_chat_id.clone()).collect();
        {
            let mut entries = self.lock();
            taken.append(&mut entries);
            *entries = taken;
        }
        self.changed(targets.iter().map(String::as_str));
    }

    /// Drops every entry owed to `target` (Stop cascade step 3).
    pub(crate) fn drop_for_target(&self, target: &str) -> usize {
        self.take_for(target).len()
    }

    /// Drops one task's delivery wherever it is queued.
    pub(crate) fn drop_task(&self, task_id: &str) {
        let is_task = |e: &OutboxEntry| matches!(&e.kind, OutboxKind::TaskResult { task_id: t } if t == task_id);
        let targets: Vec<String> = {
            let mut entries = self.lock();
            let targets = entries
                .iter()
                .filter(|e| is_task(e))
                .map(|e| e.target_chat_id.clone())
                .collect();
            entries.retain(|e| !is_task(e));
            targets
        };
        self.changed(targets.iter().map(String::as_str));
    }

    /// The user's cancel on a pending agent message.
    pub fn cancel(&self, target: &str, entry_id: &str) -> bool {
        let removed = {
            let mut entries = self.lock();
            let before = entries.len();
            entries.retain(|e| !(e.target_chat_id == target && e.entry_id == entry_id));
            entries.len() != before
        };
        if removed {
            self.changed([target]);
        }
        removed
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<OutboxEntry>> {
        self.entries.lock_recover()
    }
}

/// One user message carrying every held entry, oldest first.
#[must_use]
pub(crate) fn batch_body(entries: &[OutboxEntry]) -> String {
    entries
        .iter()
        .map(|e| e.body.as_str())
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn take_for_batches_only_the_target_in_order() {
        let outbox = Outbox::new();
        outbox.push("t", "a", OutboxKind::Send, "one".into(), "one");
        outbox.push("other", "a", OutboxKind::Send, "x".into(), "x");
        outbox.push("t", "b", OutboxKind::Send, "two".into(), "two");
        let taken = outbox.take_for("t");
        assert_eq!(batch_body(&taken), "one\n\ntwo");
        assert!(!outbox.has_for("t"));
        assert!(outbox.has_for("other"));
    }

    #[test]
    fn cancel_and_drop_remove_entries() {
        let outbox = Outbox::new();
        let id = outbox.push("t", "a", OutboxKind::Send, "one".into(), "one");
        outbox.push(
            "p",
            "c",
            OutboxKind::TaskResult {
                task_id: "k".into(),
            },
            "r".into(),
            "r",
        );
        assert!(!outbox.cancel("t", "nope"));
        assert!(outbox.cancel("t", &id));
        outbox.drop_task("k");
        assert!(outbox.targets().is_empty());
    }

    #[test]
    fn every_change_reports_its_target_once() {
        let seen = std::sync::Arc::new(Mutex::new(Vec::<String>::new()));
        let outbox = {
            let seen = std::sync::Arc::clone(&seen);
            Outbox::observed(move |t| seen.lock().unwrap().push(t.to_string()))
        };
        let id = outbox.push("t", "a", OutboxKind::Send, "one".into(), "one");
        outbox.push(
            "p",
            "c",
            OutboxKind::TaskResult {
                task_id: "k".into(),
            },
            "r".into(),
            "r",
        );
        assert!(outbox.cancel("t", &id));
        assert!(!outbox.cancel("t", &id));
        outbox.drop_task("k");
        assert!(outbox.take_for("p").is_empty());
        outbox.push("t", "a", OutboxKind::Send, "two".into(), "two");
        let taken = outbox.take_for("t");
        outbox.restore(taken);
        assert_eq!(
            *seen.lock().unwrap(),
            vec!["t", "p", "t", "p", "t", "t", "t"]
        );
    }

    #[test]
    fn restore_puts_entries_back_first() {
        let outbox = Outbox::new();
        outbox.push("t", "a", OutboxKind::Send, "one".into(), "one");
        let taken = outbox.take_for("t");
        outbox.push("t", "a", OutboxKind::Send, "two".into(), "two");
        outbox.restore(taken);
        assert_eq!(batch_body(&outbox.take_for("t")), "one\n\ntwo");
    }
}
