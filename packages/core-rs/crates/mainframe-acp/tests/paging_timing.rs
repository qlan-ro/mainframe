#![allow(clippy::unwrap_used, clippy::expect_used, reason = "test fixtures")]

//! Manual timing of a page, a page around an item and a search, comparing the
//! old path (clone the list, then serve) with the new one (serve the borrowed
//! list). Run with
//! `cargo test --release -p mainframe-acp --test paging_timing -- --ignored --nocapture`.

use std::time::Instant;

use mainframe_acp::history_page::{PageOptions, prepare};
use mainframe_acp::{encoder, history_around, history_search};
use mainframe_types::acp::extensions::{HistoryAroundParams, HistoryPageParams};
use mainframe_types::display::DisplayMessage;
use serde_json::json;

fn history(turns: usize) -> Vec<DisplayMessage> {
    let body = "lorem ipsum dolor sit amet ".repeat(40);
    let mut out = Vec::with_capacity(turns * 2);
    for turn in 0..turns {
        out.push(
            serde_json::from_value(json!({"id":format!("u{turn}"),"chatId":"c","type":"user",
                "timestamp":"now","content":[{"type":"text","text":format!("question {turn} {body}")}]}))
            .unwrap(),
        );
        out.push(
            serde_json::from_value(
                json!({"id":format!("a{turn}"),"chatId":"c","type":"assistant",
                "timestamp":"now","content":[
                    {"type":"text","text":format!("answer {turn} {body}")},
                    {"type":"tool_call","id":format!("t{turn}"),"name":"Read","input":{"path":"x"},
                        "category":"default","result":{"content":body,"isError":false}}
                ]}),
            )
            .unwrap(),
        );
    }
    out
}

fn page_params(messages: &[DisplayMessage]) -> HistoryPageParams {
    let ids: Vec<_> = encoder::encode_containers(&messages[messages.len() - 10..], None)
        .into_iter()
        .flatten()
        .map(|item| item.id().to_owned())
        .collect();
    HistoryPageParams {
        session_id: "c".into(),
        before: ids[0].clone(),
        containers: Some(40),
        items: None,
        until_item_id: None,
    }
}

fn around_params(messages: &[DisplayMessage]) -> HistoryAroundParams {
    HistoryAroundParams {
        session_id: "c".into(),
        item_id: messages[messages.len() / 2].id.clone(),
        before: Some(40),
        after: Some(40),
    }
}

fn median_ms(mut run: impl FnMut()) -> f64 {
    let mut times: Vec<f64> = (0..15)
        .map(|_| {
            let start = Instant::now();
            run();
            start.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    times.sort_by(f64::total_cmp);
    times[times.len() / 2]
}

#[test]
#[ignore = "manual release-mode timing"]
fn page_and_search_timing_with_and_without_the_clone() {
    for turns in [500, 3000] {
        let messages = history(turns);
        let page = page_params(&messages);
        let around = around_params(&messages);
        let opts = PageOptions::default();
        let rows = [
            (
                "page",
                median_ms(|| drop(prepare(&messages.to_vec(), &page, opts))),
                median_ms(|| drop(prepare(&messages, &page, opts))),
            ),
            (
                "around",
                median_ms(|| drop(history_around::prepare(&messages.to_vec(), &around, opts))),
                median_ms(|| drop(history_around::prepare(&messages, &around, opts))),
            ),
            (
                "search",
                median_ms(|| drop(history_search::search(&messages.to_vec(), "answer 7"))),
                median_ms(|| drop(history_search::search(&messages, "answer 7"))),
            ),
        ];
        for (name, before, after) in rows {
            println!(
                "containers={} {name:<7} clone+serve={before:8.2} ms  borrowed={after:8.2} ms",
                messages.len()
            );
        }
    }
}
