//! A snapshot's fingerprint, read without its messages.
//!
//! A snapshot is one JSON object written in field order, and `fingerprint`
//! comes before `messages`. Reading the file from its start and stopping at
//! the fingerprint costs a few kilobytes, where the whole snapshot of a large
//! chat is tens of megabytes. That is enough to tell a stale snapshot from a
//! current one: after an update (a new daemon version or snapshot format) or
//! a turn the daemon never saw, every stored snapshot is stale.
use std::fmt;
use std::io::Read as _;

use serde::Deserializer as _;
use serde::de::{Error as _, IgnoredAny, MapAccess, Visitor};

use super::*;

/// The most of a snapshot's start the peek reads. Snapshots are written
/// fingerprint first. A file written before that (by a build with the same
/// daemon version and format, so its fingerprint can still match) leads with
/// `adapter_state` and `dependencies`. With its fingerprint inside this limit
/// it is read, served as current and left as it is until the transcript
/// changes; with it past the limit it reads as stale, so the load parses the
/// transcript and writes the snapshot again, fingerprint first.
const HEAD_LIMIT: u64 = 1 << 20;

/// What the visitor reports when it stops the read on purpose.
const FOUND: &str = "fingerprint found";

impl HistorySnapshotCache {
    /// Whether this chat's stored snapshot was written for the transcript as
    /// it is now (its source stamps, format and daemon version). A missing,
    /// unreadable or stale file is not current. The dependency and adapter
    /// checks are left to the load, which a current fingerprint sends there.
    pub(crate) async fn has_current_snapshot(
        &self,
        chat_id: &str,
        session: &dyn mainframe_adapter_api::AdapterSession,
        context: Option<&str>,
    ) -> bool {
        let Some(expected) = Self::fingerprint(session, context).await else {
            return false;
        };
        self.peek_fingerprint(chat_id).await.as_ref() == Some(&expected)
    }

    /// The fingerprint at the start of this chat's snapshot file, if any.
    pub(crate) async fn peek_fingerprint(&self, chat_id: &str) -> Option<HistoryFingerprint> {
        let path = self.snapshot_path(chat_id);
        tokio::task::spawn_blocking(move || read_fingerprint(&path))
            .await
            .ok()
            .flatten()
    }
}

fn read_fingerprint(path: &Path) -> Option<HistoryFingerprint> {
    let file = std::fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file).take(HEAD_LIMIT);
    let mut found = None;
    let mut deserializer = serde_json::Deserializer::from_reader(reader);
    // The visitor ends the read with an error as soon as it holds the
    // fingerprint, so the messages after it are never parsed: an error with a
    // fingerprint in hand is the normal end.
    let read = (&mut deserializer).deserialize_map(Head(&mut found));
    if found.is_none()
        && let Err(err) = read
    {
        tracing::debug!(error = %err, path = %path.display(), "snapshot fingerprint unreadable");
    }
    found
}

struct Head<'a>(&'a mut Option<HistoryFingerprint>);

impl<'de> Visitor<'de> for Head<'_> {
    type Value = ();

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a history snapshot")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<(), A::Error> {
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "fingerprint" => {
                    *self.0 = Some(map.next_value()?);
                    return Err(A::Error::custom(FOUND));
                }
                // A file that reaches its messages first was not written by
                // this format: treat it as having no readable fingerprint.
                "messages" => return Err(A::Error::custom("messages before the fingerprint")),
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "history_cache_peek_tests.rs"]
mod tests;
