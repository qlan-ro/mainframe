use std::collections::HashSet;

use mainframe_types::acp::extensions::{
    HistoryPageParams, HistoryPageResult, HistoryState, ReplayBatchParams,
};
use mainframe_types::display::DisplayMessage;

use crate::{EncodedItem, SessionState, history_window, replay_previews};

#[path = "history_page_items.rs"]
mod items;

pub struct PreparedPage {
    pub result: HistoryPageResult,
    pub containers: Vec<Vec<EncodedItem>>,
    pub start: usize,
    pub len: usize,
    pub previews: HashSet<String>,
}

#[derive(Clone, Copy, Default)]
pub struct PageOptions {
    pub previews: bool,
    pub compressed: bool,
    pub lazy_tool_images: bool,
}

pub fn prepare(
    messages: &[DisplayMessage],
    params: &HistoryPageParams,
    options: PageOptions,
) -> PreparedPage {
    let mut page = PreparedPage {
        result: HistoryPageResult::default(),
        containers: Vec::new(),
        start: 0,
        len: messages.len(),
        previews: HashSet::new(),
    };
    if params.items.is_some() {
        items::prepare(messages, params, &mut page);
        if !page.containers.is_empty() {
            prepare_content(messages, params, options, &mut page);
        }
        return page;
    }
    let Some(before) = history_window::find_item(messages, &params.before) else {
        page.result.stale = Some(true);
        return page;
    };
    page.start = before;
    page.result.history = HistoryState {
        has_more: before > 0,
        floor_item_id: Some(params.before.clone()),
        context_item_ids: None,
    };
    let Some(start) = page_start(messages, params, before) else {
        page.result.stale = Some(true);
        return page;
    };
    if start >= before {
        return page;
    }
    page.start = history_window::snap(messages, start);
    page.containers = history_window::encode_range(messages, None, page.start, before);
    prepare_content(messages, params, options, &mut page);
    page
}

fn page_start(
    messages: &[DisplayMessage],
    params: &HistoryPageParams,
    before: usize,
) -> Option<usize> {
    match &params.until_item_id {
        Some(target) => history_window::find_item(messages, target),
        None => Some(before.saturating_sub(history_window::page_size(params.containers))),
    }
}

fn prepare_content(
    messages: &[DisplayMessage],
    params: &HistoryPageParams,
    options: PageOptions,
    page: &mut PreparedPage,
) {
    if options.previews {
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
    let mut updates = state.diff(&items);
    if options.lazy_tool_images {
        for update in &mut updates {
            crate::tool_images::reference_images(&params.session_id, update);
        }
    }
    if params.items.is_none() {
        page.result.history = history_window::state(page.start, &page.containers);
    }
    if options.compressed {
        page.result.batches = Some(batch_params(&params.session_id, &updates));
    } else {
        page.result.updates = Some(updates);
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;
    use serde_json::{Value, json};
    use std::io::Read;

    #[test]
    fn pages_reference_nested_images_without_changing_canonical_items_or_legacy_delivery() {
        let messages: Vec<DisplayMessage> = serde_json::from_value(json!([
            {"id":"m0","chatId":"chat","type":"assistant","timestamp":"now","content":[
                {"type":"task_group","agentId":"agent","taskArgs":{},"calls":[
                    {"type":"tool_call","id":"tool","name":"Read","input":{},"category":"default",
                    "result":{"content":"screenshot","isError":false,
                        "images":[{"mediaType":"image/png","data":"AAAA"}]}}
                ]}
            ]},
            {"id":"m1","chatId":"chat","type":"user","timestamp":"now","content":[
                {"type":"text","text":"tail"}
            ]}
        ]))
        .unwrap();
        let params = HistoryPageParams {
            session_id: "chat".into(),
            before: "m1".into(),
            containers: Some(1),
            items: None,
            until_item_id: None,
        };
        for compressed in [false, true] {
            let legacy = prepare(
                &messages,
                &params,
                PageOptions {
                    compressed,
                    ..Default::default()
                },
            );
            let lazy = prepare(
                &messages,
                &params,
                PageOptions {
                    compressed,
                    lazy_tool_images: true,
                    ..Default::default()
                },
            );
            assert_eq!(lazy.containers, legacy.containers);
            let legacy = decode(legacy.result);
            let lazy = decode(lazy.result);
            let image = |updates: Value| {
                updates
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|update| update["toolCallId"] == "tool")
                    .unwrap()["content"][1]["content"]
                    .clone()
            };
            assert_eq!(image(legacy)["data"], "AAAA");
            let image = image(lazy);
            assert_eq!(image["data"], "");
            assert!(
                image["uri"]
                    .as_str()
                    .unwrap()
                    .starts_with("/api/chats/chat/tool-result/tool/images/0?v=")
            );
        }
    }

    fn decode(result: HistoryPageResult) -> Value {
        if let Some(updates) = result.updates {
            return serde_json::to_value(updates).unwrap();
        }
        let mut updates = Vec::<Value>::new();
        for batch in result.batches.unwrap() {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(batch.data)
                .unwrap();
            let mut text = String::new();
            flate2::read::ZlibDecoder::new(bytes.as_slice())
                .read_to_string(&mut text)
                .unwrap();
            updates.extend(serde_json::from_str::<Vec<Value>>(&text).unwrap());
        }
        Value::Array(updates)
    }
}
