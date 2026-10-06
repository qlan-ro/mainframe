//! Messages Mainframe holds for a busy chat and sends, batched into one user
//! message, once that chat is idle. Unlike the CLI's own queue this never
//! folds into a running turn, works the same on every adapter, and can drop
//! entries when a chat is stopped. In memory only: a `queue` send's caller
//! turn dies with the daemon too.

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

#[derive(Default)]
pub struct Outbox {
    entries: Mutex<Vec<OutboxEntry>>,
    next_id: AtomicU64,
}

impl Outbox {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
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
        entry_id
    }

    #[must_use]
    pub fn has_for(&self, target: &str) -> bool {
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
    pub fn list_for(&self, target: &str) -> Vec<OutboxEntry> {
        self.lock()
            .iter()
            .filter(|e| e.target_chat_id == target)
            .cloned()
            .collect()
    }

    /// Removes and returns every entry owed to `target`, oldest first.
    pub fn take_for(&self, target: &str) -> Vec<OutboxEntry> {
        let mut entries = self.lock();
        let (taken, kept): (Vec<_>, Vec<_>) =
            entries.drain(..).partition(|e| e.target_chat_id == target);
        *entries = kept;
        taken
    }

    /// Puts entries back at the front, after a failed delivery.
    pub fn restore(&self, mut taken: Vec<OutboxEntry>) {
        let mut entries = self.lock();
        taken.append(&mut entries);
        *entries = taken;
    }

    /// Drops every entry owed to `target` (Stop cascade step 3).
    pub fn drop_for_target(&self, target: &str) -> usize {
        self.take_for(target).len()
    }

    /// Drops one task's delivery wherever it is queued.
    pub fn drop_task(&self, task_id: &str) {
        self.lock()
            .retain(|e| !matches!(&e.kind, OutboxKind::TaskResult { task_id: t } if t == task_id));
    }

    /// The user's cancel on a pending agent message.
    pub fn cancel(&self, target: &str, entry_id: &str) -> bool {
        let mut entries = self.lock();
        let before = entries.len();
        entries.retain(|e| !(e.target_chat_id == target && e.entry_id == entry_id));
        entries.len() != before
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<OutboxEntry>> {
        self.entries.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// One user message carrying every held entry, oldest first.
#[must_use]
pub fn batch_body(entries: &[OutboxEntry]) -> String {
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
    fn restore_puts_entries_back_first() {
        let outbox = Outbox::new();
        outbox.push("t", "a", OutboxKind::Send, "one".into(), "one");
        let taken = outbox.take_for("t");
        outbox.push("t", "a", OutboxKind::Send, "two".into(), "two");
        outbox.restore(taken);
        assert_eq!(batch_body(&outbox.take_for("t")), "one\n\ntwo");
    }
}
