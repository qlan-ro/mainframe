//! Seeding a chat's revision log after its first resume has been answered.
//!
//! The reply to a windowed first resume carries 40 groups, but seeding the log
//! encodes the whole transcript (about 70 ms on a large chat, and every Codex
//! open). That work sits behind the reply instead of in front of it, the way
//! the persisted-tail path already leaves it. Until it finishes the log reads
//! as unseeded, and everything that reads the log already copes:
//!
//! - a live delta on an unseeded log records the full snapshot, which seeds
//!   it (`RevisionLog::record_delta`), so the seed below finds nothing to do;
//! - a history page seeds the log first (`history_seed_pending`, off the cache
//!   lock), and whichever seeder takes the log lock second finds it seeded;
//! - a revision-cursor resume seeds eagerly (it plans against the log);
//! - an epoch reset swaps in a new, unseeded log, and this seed stays on the
//!   old one it was handed.
//!
//! The log is only ever seeded while it has recorded nothing, so the copy can
//! never overwrite a revision a live delta recorded; and the copy is the one
//! the reply was built from, so the baseline is what that reply sent.

use std::sync::{Arc, Mutex};

use mainframe_acp::EncodedItem;
use mainframe_acp::encoder::encode_containers;
use mainframe_acp::resume::SeedCopy;
use mainframe_acp::revision_log::RevisionLog;
use mainframe_types::sync::LockExt as _;
use tracing::info;

/// Seed `log` from the copy the reply was planned against, off the reply path
/// and off the chat cache lock. A no-op when the log is already seeded. The
/// copy is the reply's own snapshot, never a second read: a message cached
/// since then but not yet emitted must reach the log as a revision, not slip
/// into the baseline at revision 0 where a reconnect would never see it.
pub(super) fn seed_after_reply(log: Arc<Mutex<RevisionLog>>, copy: SeedCopy, chat_id: String) {
    if log.lock_recover().is_seeded() {
        return;
    }
    tokio::task::spawn_blocking(move || {
        let started = std::time::Instant::now();
        let seeded = seed_unseeded(&log, || encode_containers(&copy.messages, copy.streaming));
        if seeded {
            info!(
                chat_id,
                seed_ms = started.elapsed().as_secs_f64() * 1000.0,
                "seeded transcript revision log after the reply"
            );
        }
    });
}

/// Seed `log` with `containers()` unless something seeded it first. The encode
/// runs outside the log lock, so a live delta is never held up behind it; the
/// lock is taken only to check and install.
pub(crate) fn seed_unseeded(
    log: &Mutex<RevisionLog>,
    containers: impl FnOnce() -> Vec<Vec<EncodedItem>>,
) -> bool {
    if log.lock_recover().is_seeded() {
        return false;
    }
    let containers = containers();
    let mut log = log.lock_recover();
    if log.is_seeded() {
        return false;
    }
    log.seed_containers(&containers);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn log() -> Mutex<RevisionLog> {
        Mutex::new(RevisionLog::new("epoch".into()))
    }

    #[test]
    fn seeds_an_unseeded_log_once() {
        let log = log();
        assert!(seed_unseeded(&log, Vec::new));
        assert!(log.lock_recover().is_seeded());
        assert!(!seed_unseeded(&log, || panic!(
            "an already seeded log is not re-encoded"
        )));
    }

    #[test]
    fn a_log_seeded_while_encoding_keeps_what_was_seeded_first() {
        let log = log();
        let seeded = seed_unseeded(&log, || {
            // A live revision lands during the encode and seeds the log itself.
            log.lock_recover().seed_containers(&[]);
            Vec::new()
        });
        assert!(
            !seeded,
            "the late seed yields to the one that got there first"
        );
    }
}
