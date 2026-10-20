use super::super::ReplayCursor;
use super::SnapshotView;
use crate::{EncodedItem, ReplayPlan, RevisionLog, history_window};
use mainframe_types::acp::extensions::{HistoryWindow, RevisionCursor};
use mainframe_types::sync::LockExt as _;
use serde_json::Value;
use std::sync::Mutex;

pub(super) struct Selection {
    pub start: usize,
    pub containers: Vec<Vec<EncodedItem>>,
    pub plan: ReplayPlan,
    pub fallback: bool,
}

impl Selection {
    pub fn new(
        snapshot: &SnapshotView<'_>,
        replay_from: Option<&Value>,
        window: &HistoryWindow,
        log: Option<&Mutex<RevisionLog>>,
    ) -> Self {
        let cursor = replay_from
            .and_then(|value| serde_json::from_value::<ReplayCursor>(value.clone()).ok());
        let revision = matches!(cursor, Some(ReplayCursor::Revision { .. }));
        let floor = window
            .floor_item_id
            .as_deref()
            .and_then(|id| log.and_then(|log| log.lock_recover().container_position(id)))
            .filter(|&position| position < snapshot.messages.len());
        let start =
            if revision { floor } else { None }.unwrap_or_else(|| newest_start(snapshot, window));
        let mut containers = history_window::encode_range(
            snapshot.messages,
            snapshot.streaming,
            start,
            snapshot.messages.len(),
        );
        let plan = resolve(
            &containers,
            start,
            cursor.as_ref(),
            window.floor_item_id.as_deref(),
            log,
        );
        let fallback = revision && matches!(plan, ReplayPlan::Full);
        let start = if fallback {
            let newest = newest_start(snapshot, window);
            if newest != start {
                containers = history_window::encode_range(
                    snapshot.messages,
                    snapshot.streaming,
                    newest,
                    snapshot.messages.len(),
                );
            }
            newest
        } else {
            start
        };
        Self {
            start,
            containers,
            plan,
            fallback,
        }
    }
}

fn newest_start(snapshot: &SnapshotView<'_>, window: &HistoryWindow) -> usize {
    history_window::snap(
        snapshot.messages,
        snapshot
            .messages
            .len()
            .saturating_sub(history_window::page_size(window.containers)),
    )
}

fn resolve(
    containers: &[Vec<EncodedItem>],
    start: usize,
    cursor: Option<&ReplayCursor>,
    floor: Option<&str>,
    log: Option<&Mutex<RevisionLog>>,
) -> ReplayPlan {
    let (Some(ReplayCursor::Revision { epoch, revision }), Some(floor), Some(log)) =
        (cursor, floor, log)
    else {
        return ReplayPlan::Full;
    };
    let items: Vec<_> = containers.iter().flatten().cloned().collect();
    if items.first().map(EncodedItem::id) != Some(floor) {
        return ReplayPlan::Full;
    }
    log.lock_recover().plan_window(
        &RevisionCursor {
            epoch: epoch.clone(),
            revision: *revision,
        },
        &items,
        start,
        floor,
    )
}
