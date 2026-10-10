//! Revision-cursor resume support, split out of `resume.rs` to keep it under
//! 300 lines. Resolves a `session/resume` cursor against a chat's `RevisionLog`
//! when the connection opted in and the chat has one; otherwise falls straight
//! through to the item/start replay (`super::replay`) with no `cursor` meta at
//! all, so a connection that never negotiated the feature sees no
//! revision-cursor fields.

use std::collections::HashSet;
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
/// chat's log (already locked for the duration of this call, under which
/// the log is seeded if unseeded and `plan` runs) paired with the boundary
/// `hub.rs::begin_resume` captured BEFORE the snapshot was read, right after
/// this resume's `AwaitingSeed` claim was installed.
///
/// That captured boundary, not this call's own `log.boundary()`, is what the
/// reply's `cursor` carries. `plan` still runs against the live log — its
/// `log_item != snapshot item` rule already covers anything that changed
/// between the captured boundary and now — but the reply must never claim
/// the client holds a revision that landed after the snapshot this call is
/// replaying against. A revision recorded in that gap (between the captured
/// boundary and this lock) reaches the client only through the hub's
/// buffered catch-up, sent after this reply; claiming it in the reply's own
/// cursor would let a later resume skip it permanently if the catch-up never
/// arrived (a dropped socket, or a client that commits the reply cursor
/// before applying catch-up).
pub(super) fn resolve(
    items: &[EncodedItem],
    containers: &[Vec<EncodedItem>],
    replay_from: Option<&Value>,
    revision_log: Option<(&Mutex<RevisionLog>, WireRevisionCursor)>,
    previews: &HashSet<String>,
) -> Resolved {
    let Some((log_mutex, boundary)) = revision_log else {
        let (updates, full_replay) = replay(items, resolve_cursor(items, replay_from), previews);
        return Resolved {
            updates,
            full_replay,
            cursor: None,
        };
    };
    let mut log = log_mutex.lock().unwrap_or_else(|err| err.into_inner());
    // `seed_containers`, not `seed`: seeds the same flat item baseline `seed`
    // would, plus the container index the hub's later `record_delta` calls
    // need.
    log.seed_containers(containers);

    let Some(cursor) = parse_revision_cursor(replay_from) else {
        // A legacy-shaped cursor (start/item/none/malformed) from an
        // opted-in connection: replay exactly as before, but still attach
        // the boundary so the client can establish its first durable
        // cursor.
        let (updates, full_replay) = replay(items, resolve_cursor(items, replay_from), previews);
        return Resolved {
            updates,
            full_replay,
            cursor: Some(boundary),
        };
    };
    match log.plan(&cursor, items) {
        ReplayPlan::Incremental(updates) => Resolved {
            updates,
            full_replay: false,
            cursor: Some(boundary),
        },
        ReplayPlan::Full => {
            let (updates, _) = replay(items, ResolvedCursor::Unknown, previews);
            Resolved {
                updates,
                full_replay: true,
                cursor: Some(boundary),
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
