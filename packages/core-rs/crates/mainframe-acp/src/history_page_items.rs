use mainframe_types::acp::extensions::{HistoryPageParams, HistoryState};
use mainframe_types::display::DisplayMessage;

use super::PreparedPage;
use crate::{history_window, item_window};

pub(super) fn prepare(
    messages: &[DisplayMessage],
    params: &HistoryPageParams,
    page: &mut PreparedPage,
) {
    let Some(before) = history_window::find_item(messages, &params.before) else {
        page.result.stale = Some(true);
        return;
    };
    page.result.history = HistoryState {
        has_more: true,
        floor_item_id: Some(params.before.clone()),
        context_item_ids: None,
    };
    let target = params
        .until_item_id
        .as_deref()
        .map(|id| history_window::find_item(messages, id));
    if target == Some(None) {
        page.result.stale = Some(true);
        return;
    }
    let target = target.flatten();
    if target.is_some_and(|target| target > before) {
        return;
    }
    let start = target.unwrap_or_else(|| {
        history_window::snap(
            messages,
            before.saturating_sub(history_window::page_size(params.containers)),
        )
    });
    let Some((start, containers)) = prefix(messages, start, before, &params.before) else {
        page.result.stale = Some(true);
        return;
    };
    if params.until_item_id.is_none() && containers.iter().all(Vec::is_empty) {
        page.result.history.has_more = false;
        return;
    }
    let selected = select(containers, start, params, &messages[start].id);
    if let Some(selected) = selected
        && selected.containers.iter().any(|items| !items.is_empty())
    {
        let selected = selected.track_context();
        page.start = selected.start;
        page.containers = selected.containers;
        page.result.history = selected.history;
    }
}

fn select(
    containers: Vec<Vec<crate::EncodedItem>>,
    start: usize,
    params: &HistoryPageParams,
    container_id: &str,
) -> Option<item_window::ItemWindow> {
    if let Some(id) = params.until_item_id.as_deref() {
        through_target(containers, start, id, container_id)
    } else {
        Some(item_window::ItemWindow::newest(
            containers,
            start,
            params.items.map(item_window::budget),
        ))
    }
}

fn through_target(
    containers: Vec<Vec<crate::EncodedItem>>,
    start: usize,
    id: &str,
    container_id: &str,
) -> Option<item_window::ItemWindow> {
    let floor = if id == container_id {
        containers.iter().flatten().next()?.id()
    } else {
        id
    }
    .to_owned();
    item_window::ItemWindow::from_floor(containers, start, &floor).ok()
}

fn prefix(
    messages: &[DisplayMessage],
    mut start: usize,
    before: usize,
    floor: &str,
) -> Option<(usize, Vec<Vec<crate::EncodedItem>>)> {
    let mut containers = history_window::encode_range(messages, None, start, before + 1);
    let last = containers.last_mut()?;
    let offset = last.iter().position(|item| item.id() == floor)?;
    last.truncate(offset);
    while containers.iter().all(Vec::is_empty) && start > 0 {
        let earlier = start.saturating_sub(history_window::DEFAULT_CONTAINERS);
        let mut prefix = history_window::encode_range(messages, None, earlier, start);
        prefix.extend(containers);
        containers = prefix;
        start = earlier;
    }
    Some((start, containers))
}
