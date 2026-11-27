use std::collections::HashSet;

use mainframe_types::acp::extensions::{
    HistoryPageParams, HistoryPageResult, HistoryState, ReplayBatchParams,
    SubagentHistoryPageParams,
};
use mainframe_types::display::DisplayMessage;

use crate::{
    EncodedItem, ResumePort, SessionState, history_window, replay_previews, resume::with_messages,
    turn_window,
};

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
    /// Send the compressed batches as binary frames (`batch_frames`) rather
    /// than base64 `batches`; takes precedence over `compressed`.
    pub binary: bool,
}

/// Serve a page from the chat's list in place. `inspect` sees the same
/// borrowed list first (the server seeds its revision log from it); `None` if
/// the port could not read it.
pub async fn prepare_chat(
    port: &dyn ResumePort,
    params: &HistoryPageParams,
    options: PageOptions,
    inspect: impl FnOnce(&[DisplayMessage]) + Send,
) -> Option<PreparedPage> {
    with_messages(port, &params.session_id, |messages| {
        inspect(messages);
        prepare(messages, params, options)
    })
    .await
}

pub fn prepare(
    messages: &[DisplayMessage],
    params: &HistoryPageParams,
    options: PageOptions,
) -> PreparedPage {
    prepare_for(messages, params, options, None)
}

/// `agent` names the sub-agent whose transcript `messages` is, so lazy image
/// references resolve against that child rather than the parent.
fn prepare_for(
    messages: &[DisplayMessage],
    params: &HistoryPageParams,
    options: PageOptions,
    agent: Option<&str>,
) -> PreparedPage {
    let mut page = PreparedPage {
        result: HistoryPageResult::default(),
        containers: Vec::new(),
        start: 0,
        len: messages.len(),
        previews: HashSet::new(),
    };
    if params.items.is_some() && params.turns.is_none() {
        items::prepare(messages, params, &mut page);
        if !page.containers.is_empty() {
            prepare_content(messages, params, options, agent, &mut page);
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
    let by_turns = params.turns.is_some() && params.until_item_id.is_none();
    page.start = if by_turns {
        start
    } else {
        history_window::snap(messages, start)
    };
    page.containers = history_window::encode_range(messages, None, page.start, before);
    if by_turns {
        page.start = turn_window::fit(
            messages,
            page.start,
            &mut page.containers,
            turn_window::MAX_WINDOW_BYTES,
        );
    }
    prepare_content(messages, params, options, agent, &mut page);
    page
}

pub fn subagent_page(
    messages: &[DisplayMessage],
    request: SubagentHistoryPageParams,
    options: PageOptions,
) -> HistoryPageResult {
    let initial = request.before.is_none();
    let agent = request.agent_id;
    let params = HistoryPageParams {
        session_id: request.session_id,
        before: request.before.unwrap_or_default(),
        containers: request.containers,
        items: None,
        turns: None,
        until_item_id: request.until_item_id,
    };
    if !initial {
        return prepare_for(messages, &params, options, Some(&agent)).result;
    }
    let end = messages.len();
    let start = history_window::snap(
        messages,
        end.saturating_sub(history_window::page_size(params.containers)),
    );
    let mut page = PreparedPage {
        result: HistoryPageResult::default(),
        containers: history_window::encode_range(messages, None, start, end),
        start,
        len: end,
        previews: HashSet::new(),
    };
    prepare_content(messages, &params, options, Some(&agent), &mut page);
    page.result
}

fn page_start(
    messages: &[DisplayMessage],
    params: &HistoryPageParams,
    before: usize,
) -> Option<usize> {
    match &params.until_item_id {
        Some(target) => history_window::find_item(messages, target),
        None => Some(match params.turns {
            Some(turns) => {
                turn_window::start_before(messages, before, turn_window::turn_count(turns))
            }
            None => before.saturating_sub(history_window::page_size(params.containers)),
        }),
    }
}

fn prepare_content(
    messages: &[DisplayMessage],
    params: &HistoryPageParams,
    options: PageOptions,
    agent: Option<&str>,
    page: &mut PreparedPage,
) {
    render(messages.len(), &params.session_id, options, agent, page);
    if params.items.is_none() || params.turns.is_some() {
        page.result.history = history_window::state(page.start, &page.containers);
    }
}

/// Turn `page.containers` into `page.result`'s updates or batches. `total` is
/// the transcript's container count: only the newest containers keep full
/// tool results when `options.previews` is set.
pub(crate) fn render(
    total: usize,
    session_id: &str,
    options: PageOptions,
    agent: Option<&str>,
    page: &mut PreparedPage,
) {
    if options.previews {
        let old = total.saturating_sub(replay_previews::FULL_RESULT_CONTAINERS);
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
            match agent {
                Some(agent) => {
                    crate::tool_images::reference_subagent_images(session_id, agent, update)
                }
                None => crate::tool_images::reference_images(session_id, update),
            }
        }
    }
    if options.binary {
        page.result.frames = crate::replay_batch::replay_batch_frames(session_id, &updates);
        page.result.batch_frames = Some(page.result.frames.len());
    } else if options.compressed {
        page.result.batches = Some(batch_params(session_id, &updates));
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
            before: "message:0:top:m1".into(),
            containers: Some(1),
            items: None,
            turns: None,
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
                    .find(|update| update["toolCallId"] == "tool:tool")
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

    #[test]
    fn binary_pages_carry_the_same_updates_as_compressed_batches() {
        let messages: Vec<DisplayMessage> = (0..300)
            .map(|index| {
                serde_json::from_value(json!({"id":format!("m{index}"),"chatId":"chat",
                    "type":"user","timestamp":"now","content":[{"type":"text","text":format!("t{index}")}]}))
                .unwrap()
            })
            .collect();
        let params = HistoryPageParams {
            session_id: "chat".into(),
            before: "message:299:top:m299".into(),
            containers: Some(200),
            items: None,
            turns: None,
            until_item_id: None,
        };
        let compressed = prepare(
            &messages,
            &params,
            PageOptions {
                compressed: true,
                ..Default::default()
            },
        );
        let binary = prepare(
            &messages,
            &params,
            PageOptions {
                compressed: true,
                binary: true,
                ..Default::default()
            },
        );
        assert!(binary.result.batches.is_none() && binary.result.updates.is_none());
        let frames = &binary.result.frames;
        assert_eq!(binary.result.batch_frames, Some(frames.len()));
        assert!(!frames.is_empty());
        let mut updates = Vec::<Value>::new();
        for frame in frames {
            let mut text = String::new();
            flate2::read::ZlibDecoder::new(frame.bytes.as_slice())
                .read_to_string(&mut text)
                .unwrap();
            let batch: Vec<Value> = serde_json::from_str(&text).unwrap();
            assert_eq!(batch.len(), frame.count);
            updates.extend(batch);
        }
        assert_eq!(Value::Array(updates), decode(compressed.result));
        let wire = serde_json::to_value(&binary.result).unwrap();
        assert!(wire.get("frames").is_none() && wire["batchFrames"] == frames.len());
    }

    #[test]
    fn subagent_pages_preview_old_results_and_reference_images_in_the_child() {
        let long = "x".repeat(4 * replay_previews::PREVIEW_BYTES);
        let mut messages: Vec<DisplayMessage> =
            vec![serde_json::from_value(json!(
            {"id":"m0","chatId":"chat","type":"assistant","timestamp":"now","content":[
                {"type":"tool_call","id":"tool","name":"Read","input":{},"category":"default",
                "result":{"content":long,"isError":false,
                    "images":[{"mediaType":"image/png","data":"AAAA"}]}}
            ]}
        ))
        .unwrap()];
        for index in 1..=replay_previews::FULL_RESULT_CONTAINERS {
            messages.push(
                serde_json::from_value(json!({"id":format!("m{index}"),"chatId":"chat",
                    "type":"user","timestamp":"now","content":[{"type":"text","text":"later"}]}))
                .unwrap(),
            );
        }
        let request = SubagentHistoryPageParams {
            session_id: "chat".into(),
            agent_id: "worker".into(),
            before: None,
            containers: None,
            until_item_id: None,
        };
        let options = PageOptions {
            previews: true,
            lazy_tool_images: true,
            compressed: true,
            ..Default::default()
        };
        let updates = decode(subagent_page(&messages, request, options));
        let tool = updates
            .as_array()
            .unwrap()
            .iter()
            .find(|update| update["toolCallId"] == "tool:tool")
            .unwrap();
        let text = tool["content"][0]["content"]["text"].as_str().unwrap();
        assert!(text.len() < long.len());
        let image = &tool["content"][1]["content"];
        assert_eq!(image["data"], "");
        let uri = image["uri"].as_str().unwrap();
        assert!(uri.starts_with("/api/chats/chat/tool-result/tool/images/0?v="));
        assert!(uri.ends_with("&agent=worker"));
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
