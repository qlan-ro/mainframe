//! Revision-cursor resume support (todo #377), split out of `resume.rs` to
//! keep it under 300 lines. Resolves a `session/resume` cursor against a
//! chat's `RevisionLog` when the connection opted in and the chat has one;
//! otherwise falls straight through to the legacy item/start replay
//! (`super::replay`) with no `cursor` meta at all — byte-identical to the
//! pre-#377 wire for a connection that never negotiated the feature.

use std::sync::Mutex;

use mainframe_types::acp::extensions::RevisionCursor as WireRevisionCursor;
use mainframe_types::acp::update::SessionUpdate;
use serde_json::Value;

use crate::encoder::EncodedItem;
use crate::revision_log::{ReplayPlan, RevisionLog};

use super::{ReplayCursor, ResolvedCursor, replay, resolve_cursor};

/// What a resolved resume produces: the replay updates, whether it fell back
/// to a full replay, and — only for an opted-in connection with a log — the
/// boundary cursor the reply's `cursor` meta carries.
pub(super) struct Resolved {
    pub updates: Vec<SessionUpdate>,
    pub full_replay: bool,
    pub cursor: Option<WireRevisionCursor>,
}

/// Resolve one `session/resume` against `items` (the fresh snapshot),
/// `replay_from` (the request's raw cursor value), and `revision_log` — the
/// chat's log, already locked for the duration of this call, under which
/// the log is seeded (if unseeded) and `plan` runs. Locking after the
/// snapshot read, not before, is the race argument `RevisionLog`'s module
/// doc and `hub.rs::begin_resume` document: any change recorded above the
/// boundary this call reads applies after this resume's `AwaitingSeed` claim
/// exists, so it comes back as buffered catch-up rather than racing ahead of
/// the snapshot this plan is computed against.
pub(super) fn resolve(
    items: &[EncodedItem],
    replay_from: Option<&Value>,
    revision_log: Option<&Mutex<RevisionLog>>,
) -> Resolved {
    let Some(log_mutex) = revision_log else {
        let (updates, full_replay) = replay(items, resolve_cursor(items, replay_from));
        return Resolved {
            updates,
            full_replay,
            cursor: None,
        };
    };
    let mut log = log_mutex.lock().unwrap_or_else(|err| err.into_inner());
    log.seed(items);

    let Some(cursor) = parse_revision_cursor(replay_from) else {
        // A legacy-shaped cursor (start/item/none/malformed) from an
        // opted-in connection: replay exactly as before, but still attach
        // the boundary so the client can establish its first durable
        // cursor.
        let (updates, full_replay) = replay(items, resolve_cursor(items, replay_from));
        return Resolved {
            updates,
            full_replay,
            cursor: Some(log.boundary()),
        };
    };
    match log.plan(&cursor, items) {
        ReplayPlan::Incremental(updates) => Resolved {
            updates,
            full_replay: false,
            cursor: Some(log.boundary()),
        },
        ReplayPlan::Full => {
            let (updates, _) = replay(items, ResolvedCursor::Unknown);
            Resolved {
                updates,
                full_replay: true,
                cursor: Some(log.boundary()),
            }
        }
    }
}

fn parse_revision_cursor(replay_from: Option<&Value>) -> Option<WireRevisionCursor> {
    let value = replay_from?;
    match serde_json::from_value::<ReplayCursor>(value.clone()) {
        Ok(ReplayCursor::Revision { epoch, revision }) => {
            Some(WireRevisionCursor { epoch, revision })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests;
