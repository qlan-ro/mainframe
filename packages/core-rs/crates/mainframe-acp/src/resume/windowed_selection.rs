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
    pub history: mainframe_types::acp::extensions::HistoryState,
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
        let mut selected = select(
            snapshot,
            start,
            window,
            revision
                .then_some(window.floor_item_id.as_deref())
                .flatten(),
        );
        let mut plan = resolve(
            &selected,
            cursor.as_ref(),
            window.floor_item_id.as_deref(),
            log,
        );
        let fallback = revision && matches!(plan, ReplayPlan::Full);
        if fallback {
            selected = select(snapshot, newest_start(snapshot, window), window, None);
        }
        let context_changed = context_changed(&selected, window, &plan);
        if context_changed {
            plan = ReplayPlan::Full;
        }
        Self {
            start: selected.start,
            containers: selected.containers,
            history: selected.history,
            plan,
            fallback: fallback || context_changed,
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

fn select(
    snapshot: &SnapshotView<'_>,
    start: usize,
    window: &HistoryWindow,
    floor: Option<&str>,
) -> crate::item_window::ItemWindow {
    let mut containers = history_window::encode_range(
        snapshot.messages,
        snapshot.streaming,
        start,
        snapshot.messages.len(),
    );
    if window.items.is_some()
        && let Some(floor) = floor
    {
        match crate::item_window::ItemWindow::from_floor(containers, start, floor) {
            Ok(selected) => return selected.track_context(),
            Err(original) => containers = original,
        }
    }
    let selected = crate::item_window::ItemWindow::newest(
        containers,
        start,
        window.items.map(crate::item_window::budget),
    );
    if window.items.is_some() {
        selected.track_context()
    } else {
        selected
    }
}

fn resolve(
    selection: &crate::item_window::ItemWindow,
    cursor: Option<&ReplayCursor>,
    floor: Option<&str>,
    log: Option<&Mutex<RevisionLog>>,
) -> ReplayPlan {
    let (Some(ReplayCursor::Revision { epoch, revision }), Some(floor), Some(log)) =
        (cursor, floor, log)
    else {
        return ReplayPlan::Full;
    };
    if selection.history.floor_item_id.as_deref() != Some(floor) {
        return ReplayPlan::Full;
    }
    let items: Vec<_> = selection.containers.iter().flatten().cloned().collect();
    log.lock_recover().plan_window(
        &RevisionCursor {
            epoch: epoch.clone(),
            revision: *revision,
        },
        &items,
        selection.start,
        floor,
    )
}

fn context_changed(
    selected: &crate::item_window::ItemWindow,
    window: &HistoryWindow,
    plan: &ReplayPlan,
) -> bool {
    matches!(plan, ReplayPlan::Incremental(_))
        && window.items.is_some()
        && selected
            .history
            .context_item_ids
            .as_deref()
            .unwrap_or_default()
            != window.context_item_ids.as_deref().unwrap_or_default()
}
