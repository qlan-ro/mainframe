//! Messages Mainframe holds for a busy chat and sends, batched into one user
//! message, once that chat is idle. Unlike the CLI's own queue this never
//! folds into a running turn, works the same on every adapter, and can drop
//! entries when a chat is stopped. In memory only: a `queue` send's caller
//! turn dies with the daemon too. Every change is reported per target, so the
//! target's `Chat.agent_outbox` stays current.

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use mainframe_types::sync::LockExt as _;

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
    pub(crate) fn observed(listener: impl Fn(&str) + Send + Sync + 'static) -> Self {
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
    pub(crate) fn push(
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
    pub(crate) fn targets(&self) -> Vec<String> {
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
        let taken: Vec<OutboxEntry> = self
            .lock()
            .extract_if(.., |e| e.target_chat_id == target)
            .collect();
        if !taken.is_empty() {
            self.changed([target]);
        }
        taken
    }

    /// Puts entries back at the front, after a failed delivery.
    pub(crate) fn restore(&self, mut taken: Vec<OutboxEntry>) {
        let targets: Vec<String> = taken.iter().map(|e| e.target_chat_id.clone()).collect();
        {
            let mut entries = self.lock();
            taken.append(&mut entries);
            *entries = taken;
        }
        self.changed(targets.iter().map(String::as_str));
    }

    /// Drops one task's delivery wherever it is queued.
    pub(crate) fn drop_task(&self, task_id: &str) {
        let is_task = |e: &OutboxEntry| match &e.kind {
            OutboxKind::TaskResult { task_id: id } => id == task_id,
            OutboxKind::Send | OutboxKind::Notice => false,
        };
        let dropped: Vec<OutboxEntry> = self.lock().extract_if(.., |e| is_task(e)).collect();
        self.changed(dropped.iter().map(|e| e.target_chat_id.as_str()));
    }

    /// The user's cancel on a pending agent message. `None` when it is gone.
    pub(crate) fn cancel(&self, target: &str, entry_id: &str) -> Option<OutboxEntry> {
        let removed = {
            let mut entries = self.lock();
            let index = entries
                .iter()
                .position(|e| e.target_chat_id == target && e.entry_id == entry_id)?;
            entries.remove(index)
        };
        self.changed([target]);
        Some(removed)
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
#[path = "outbox_tests.rs"]
mod tests;
