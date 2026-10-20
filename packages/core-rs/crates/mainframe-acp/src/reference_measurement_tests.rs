use crate::{RevisionLog, SessionState, encoder, history_window};
use mainframe_types::display::{DisplayContent, DisplayMessage, DisplayMessageType};
use serde_json::json;
use std::time::Instant;

fn reference_transcript() -> Vec<DisplayMessage> {
    (0..500).map(|i| {
        let user = i % 2 == 0;
        let text = |value: &str| serde_json::from_value::<DisplayContent>(json!({"type":"text","text":value})).unwrap();
        let mut content = vec![text(&format!("Reference message {i}: searchable history"))];
        if !user {
            for tool in 0..4 {
                content.push(serde_json::from_value(json!({"type":"tool_call","id":format!("tool-{i}-{tool}"),"name":"Read","input":{},"category":"default",
                    "result":{"content":"x".repeat(32768),"isError":false}})).unwrap());
                content.push(text("Tool result summary"));
            }
        }
        DisplayMessage { id: format!("message-{i}"), chat_id:"reference".into(), r#type:if user { DisplayMessageType::User } else { DisplayMessageType::Assistant },
            content, timestamp:"2026-10-19T12:00:00Z".into(), metadata:None }
    }).collect()
}

#[test]
#[ignore = "manual release-mode protocol measurement"]
fn reference_transcript_measurement() {
    let messages = reference_transcript();
    let started = Instant::now();
    let containers = encoder::encode_containers(&messages, None);
    let mut log = RevisionLog::new("reference".into());
    log.seed_containers(&containers);
    let seed_ms = started.elapsed().as_secs_f64() * 1000.0;
    let items: Vec<_> = containers.iter().flatten().cloned().collect();
    assert!(items.len() >= 2000);
    let baseline = SessionState::new().diff(&items);
    let full_bytes = serde_json::to_vec(&baseline).unwrap().len();
    assert!(full_bytes > 20_000_000);
    let started = Instant::now();
    let window = history_window::encode_range(&messages, None, 460, 500);
    let mut state = SessionState::new();
    state.set_previews(crate::preview_ids(&window));
    let window_items: Vec<_> = window.iter().flatten().cloned().collect();
    let updates = state.diff(&window_items);
    let window_ms = started.elapsed().as_secs_f64() * 1000.0;
    let window_bytes = serde_json::to_vec(&updates).unwrap().len();
    assert!(window_bytes < 3_000_000);
    assert!(window_bytes * 10 < full_bytes);
    println!(
        "containers=500 items={} seed_ms={seed_ms:.2} full_bytes={full_bytes} window_ms={window_ms:.2} window_bytes={window_bytes}",
        items.len()
    );
}
