use std::collections::HashSet;

use mainframe_types::acp::extensions::{
    HistoryPageParams, HistoryPageResult, HistoryState, ReplayBatchParams,
};
use mainframe_types::display::DisplayMessage;

use crate::{EncodedItem, SessionState, history_window, replay_previews};

pub struct PreparedPage {
    pub result: HistoryPageResult,
    pub containers: Vec<Vec<EncodedItem>>,
    pub start: usize,
    pub len: usize,
    pub previews: HashSet<String>,
}

pub fn prepare(
    messages: &[DisplayMessage],
    params: &HistoryPageParams,
    previews: bool,
    compressed: bool,
) -> PreparedPage {
    let mut page = PreparedPage {
        result: HistoryPageResult::default(),
        containers: Vec::new(),
        start: 0,
        len: messages.len(),
        previews: HashSet::new(),
    };
    let Some(before) = history_window::find_item(messages, &params.before) else {
        page.result.stale = Some(true);
        return page;
    };
    page.start = before;
    page.result.history = HistoryState {
        has_more: before > 0,
        floor_item_id: Some(params.before.clone()),
    };
    let start = if let Some(target) = &params.until_item_id {
        let Some(target) = history_window::find_item(messages, target) else {
            page.result.stale = Some(true);
            return page;
        };
        if target >= before {
            return page;
        }
        target
    } else {
        before.saturating_sub(history_window::page_size(params.containers))
    };
    page.start = history_window::snap(messages, start);
    page.containers = history_window::encode_range(messages, None, page.start, before);
    if previews {
        let old = messages
            .len()
            .saturating_sub(replay_previews::FULL_RESULT_CONTAINERS);
        let count = old.saturating_sub(page.start).min(page.containers.len());
        let mut candidates = page.containers[..count].to_vec();
        candidates.resize_with(count + replay_previews::FULL_RESULT_CONTAINERS, Vec::new);
        page.previews = replay_previews::preview_ids(&candidates);
    }
    let items: Vec<_> = page.containers.iter().flatten().cloned().collect();
    let mut state = SessionState::new();
    state.set_previews(page.previews.clone());
    let updates = state.diff(&items);
    page.result.history = history_window::state(page.start, &page.containers);
    if compressed {
        page.result.batches = Some(batch_params(&params.session_id, &updates));
    } else {
        page.result.updates = Some(updates);
    }
    page
}

fn batch_params(
    session_id: &str,
    updates: &[mainframe_types::acp::update::SessionUpdate],
) -> Vec<ReplayBatchParams> {
    crate::replay_batch_notifications(session_id, updates)
        .into_iter()
        .filter_map(|note| {
            note.params
                .and_then(|params| serde_json::from_value(params).ok())
        })
        .collect()
}
