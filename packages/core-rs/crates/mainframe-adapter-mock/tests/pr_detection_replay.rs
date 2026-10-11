//! "Any adapter inherits detection" spec: drives the mock
//! adapter — a stand-in for "some adapter that isn't Claude" — through
//! `PrDetectionSink` using only the crate's public replay surface (`dispatch`
//! is private, `emit_event` is `pub(crate)`; see `src/dispatch.rs:23,29`).
//! Proves the decorator applies to every adapter, not just Claude's own
//! NDJSON handlers.
#![allow(clippy::too_many_lines)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::Arc;
use std::time::Duration;

use mainframe_adapter_api::AdapterSession;
use mainframe_adapter_api::pr_detection::PrDetectionSink;
use mainframe_adapter_mock::{ReplaySession, parse_fixture};
use mainframe_types::adapter::{DetectedPr, DetectedPrSource, SessionOptions};

use mainframe_adapter_api::test_support::RecordingSink;

fn options(project_path: String) -> SessionOptions {
    SessionOptions {
        project_path,
        chat_id: None,
        mainframe_chat_id: "chat-1".to_string(),
        session_file_path: None,
        fork_source: None,
    }
}

#[tokio::test]
async fn mock_adapter_output_is_detected_through_the_shared_sink_decorator() {
    // The fixture deliberately contains no `onPrDetected` event: the decorator
    // delegates that call straight through, so a recorded one would satisfy
    // the assertion below without any detection actually happening.
    let lines = [
        serde_json::json!({
            "dir": "in",
            "method": "sendMessage",
            "args": [],
            "delayMs": 0
        })
        .to_string(),
        serde_json::json!({
            "dir": "out",
            "method": "onMessage",
            "args": [
                [{
                    "type": "tool_use",
                    "id": "tu1",
                    "name": "Bash",
                    "input": { "command": "gh pr create --title x" }
                }],
                null
            ],
            "delayMs": 0
        })
        .to_string(),
        serde_json::json!({
            "dir": "out",
            "method": "onToolResult",
            "args": [
                [{
                    "type": "tool_result",
                    "toolUseId": "tu1",
                    "content": "Created https://github.com/acme/repo/pull/7",
                    "isError": false
                }]
            ],
            "delayMs": 0
        })
        .to_string(),
    ];

    let session = ReplaySession::new(
        options("/tmp/mf-pr-detection-replay".to_string()),
        parse_fixture(&lines.join("\n")).unwrap(),
    );
    let inner = Arc::new(RecordingSink::default());
    session
        .spawn(None, Some(Arc::new(PrDetectionSink::new(inner.clone()))))
        .await
        .unwrap();

    session
        .send_message(String::new(), Vec::new(), None)
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), inner.wait_for_pr())
        .await
        .unwrap();

    assert_eq!(
        inner.prs(),
        vec![DetectedPr {
            url: "https://github.com/acme/repo/pull/7".to_string(),
            owner: "acme".to_string(),
            repo: "repo".to_string(),
            number: 7,
            source: DetectedPrSource::Created,
        }]
    );
}
