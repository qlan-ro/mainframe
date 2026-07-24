//! Round-trip tests for the B1 ThreadItem variants: `subAgentActivity`,
//! `dynamicToolCall`, `enteredReviewMode`, `exitedReviewMode`, `imageView`,
//! `sleep`, `hookPrompt`. Field shapes come from the codex 0.144.3 ts-rs schema
//! (`ThreadItem.ts` at tag `rust-v0.144.3`), not hand-guessed.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use mainframe_adapter_codex::item_types::ThreadItem;
use mainframe_adapter_codex::types::ThreadReadResult;
use serde_json::json;

fn parse(v: serde_json::Value) -> ThreadItem {
    serde_json::from_value(v).expect("item must deserialize")
}

#[test]
fn sub_agent_activity_round_trips() {
    let item = parse(json!({
        "id": "sa1",
        "type": "subAgentActivity",
        "kind": "started",
        "agentThreadId": "child_1",
        "agentPath": "agents/reviewer",
    }));
    match item {
        ThreadItem::SubAgentActivity(a) => {
            assert_eq!(a.id, "sa1");
            assert_eq!(a.kind, "started");
            assert_eq!(a.agent_thread_id, "child_1");
            assert_eq!(a.agent_path, "agents/reviewer");
        }
        other => panic!("expected SubAgentActivity, got {other:?}"),
    }
}

#[test]
fn sub_agent_activity_tolerates_an_unknown_extra_field() {
    let item = parse(json!({
        "id": "sa1",
        "type": "subAgentActivity",
        "kind": "interacted",
        "agentThreadId": "child_1",
        "agentPath": "agents/reviewer",
        "somethingNew": 42,
    }));
    assert!(matches!(item, ThreadItem::SubAgentActivity(_)));
}

#[test]
fn dynamic_tool_call_round_trips() {
    let item = parse(json!({
        "id": "dt1",
        "type": "dynamicToolCall",
        "namespace": "browser",
        "tool": "click",
        "arguments": { "selector": "#go" },
        "status": "completed",
        "contentItems": [
            { "type": "inputText", "text": "clicked" },
            { "type": "inputImage", "imageUrl": "https://example.com/a.png" },
        ],
        "success": true,
        "durationMs": 120,
    }));
    match item {
        ThreadItem::DynamicToolCall(d) => {
            assert_eq!(d.id, "dt1");
            assert_eq!(d.namespace.as_deref(), Some("browser"));
            assert_eq!(d.tool, "click");
            assert_eq!(d.arguments, json!({ "selector": "#go" }));
            assert_eq!(d.status, "completed");
            assert_eq!(d.success, Some(true));
            assert_eq!(d.duration_ms, Some(120));
            let items = d.content_items.expect("contentItems must be present");
            assert_eq!(items.len(), 2);
        }
        other => panic!("expected DynamicToolCall, got {other:?}"),
    }
}

#[test]
fn dynamic_tool_call_tolerates_null_content_items_and_unknown_field() {
    let item = parse(json!({
        "id": "dt2",
        "type": "dynamicToolCall",
        "namespace": null,
        "tool": "noop",
        "arguments": {},
        "status": "inProgress",
        "contentItems": null,
        "success": null,
        "durationMs": null,
        "somethingNew": "x",
    }));
    match item {
        ThreadItem::DynamicToolCall(d) => {
            assert_eq!(d.namespace, None);
            assert_eq!(d.content_items, None);
        }
        other => panic!("expected DynamicToolCall, got {other:?}"),
    }
}

#[test]
fn entered_review_mode_round_trips() {
    let item = parse(json!({ "id": "erm1", "type": "enteredReviewMode", "review": "security" }));
    match item {
        ThreadItem::EnteredReviewMode(e) => {
            assert_eq!(e.id, "erm1");
            assert_eq!(e.review, "security");
        }
        other => panic!("expected EnteredReviewMode, got {other:?}"),
    }
}

#[test]
fn entered_review_mode_tolerates_an_unknown_extra_field() {
    let item = parse(
        json!({ "id": "erm1", "type": "enteredReviewMode", "review": "security", "extra": 1 }),
    );
    assert!(matches!(item, ThreadItem::EnteredReviewMode(_)));
}

#[test]
fn exited_review_mode_round_trips() {
    let item = parse(json!({ "id": "xrm1", "type": "exitedReviewMode", "review": "security" }));
    match item {
        ThreadItem::ExitedReviewMode(e) => {
            assert_eq!(e.id, "xrm1");
            assert_eq!(e.review, "security");
        }
        other => panic!("expected ExitedReviewMode, got {other:?}"),
    }
}

#[test]
fn exited_review_mode_tolerates_an_unknown_extra_field() {
    let item = parse(
        json!({ "id": "xrm1", "type": "exitedReviewMode", "review": "security", "extra": 1 }),
    );
    assert!(matches!(item, ThreadItem::ExitedReviewMode(_)));
}

#[test]
fn image_view_round_trips() {
    let item = parse(json!({ "id": "iv1", "type": "imageView", "path": "/tmp/screenshot.png" }));
    match item {
        ThreadItem::ImageView(i) => {
            assert_eq!(i.id, "iv1");
            assert_eq!(i.path, "/tmp/screenshot.png");
        }
        other => panic!("expected ImageView, got {other:?}"),
    }
}

#[test]
fn image_view_tolerates_an_unknown_extra_field() {
    let item = parse(
        json!({ "id": "iv1", "type": "imageView", "path": "/tmp/screenshot.png", "extra": true }),
    );
    assert!(matches!(item, ThreadItem::ImageView(_)));
}

#[test]
fn sleep_round_trips() {
    let item = parse(json!({ "id": "sl1", "type": "sleep", "durationMs": 500 }));
    match item {
        ThreadItem::Sleep(s) => {
            assert_eq!(s.id, "sl1");
            assert_eq!(s.duration_ms, 500);
        }
        other => panic!("expected Sleep, got {other:?}"),
    }
}

#[test]
fn sleep_tolerates_an_unknown_extra_field() {
    let item = parse(json!({ "id": "sl1", "type": "sleep", "durationMs": 500, "extra": "x" }));
    assert!(matches!(item, ThreadItem::Sleep(_)));
}

#[test]
fn hook_prompt_round_trips() {
    let item = parse(json!({
        "id": "hp1",
        "type": "hookPrompt",
        "fragments": [
            { "text": "run the linter", "hookRunId": "run_1" },
            { "text": "then the tests", "hookRunId": "run_2" },
        ],
    }));
    match item {
        ThreadItem::HookPrompt(h) => {
            assert_eq!(h.id, "hp1");
            assert_eq!(h.fragments.len(), 2);
            assert_eq!(h.fragments[0].text, "run the linter");
            assert_eq!(h.fragments[0].hook_run_id, "run_1");
        }
        other => panic!("expected HookPrompt, got {other:?}"),
    }
}

#[test]
fn hook_prompt_tolerates_an_unknown_extra_field() {
    let item = parse(json!({
        "id": "hp1",
        "type": "hookPrompt",
        "fragments": [{ "text": "x", "hookRunId": "run_1" }],
        "extra": 1,
    }));
    assert!(matches!(item, ThreadItem::HookPrompt(_)));
}

// --- Lenient-unknown belongs to the ThreadReadTurn.items seam, not bare ThreadItem ---
//
// A bare `serde_json::from_str::<ThreadItem>` on an unrecognized `type` correctly
// hard-errors (internally-tagged enum working as designed). #502's tolerance lives
// in `deserialize_lenient_items` on `ThreadReadTurn.items`.

#[test]
fn bare_thread_item_hard_errors_on_an_unknown_type() {
    let result: Result<ThreadItem, _> = serde_json::from_value(json!({
        "id": "u1",
        "type": "somethingCodexAddsLater",
    }));
    assert!(result.is_err());
}

#[test]
fn thread_read_turn_drops_an_unknown_typed_item_interleaved_with_known_ones() {
    let payload = json!({
        "thread": {
            "id": "t1",
            "turns": [{
                "id": "turn1",
                "status": "completed",
                "items": [
                    { "id": "a1", "type": "agentMessage", "text": "before", "phase": null },
                    { "id": "u1", "type": "somethingCodexAddsLater", "whatever": true },
                    { "id": "sl1", "type": "sleep", "durationMs": 10 },
                ]
            }]
        }
    });

    let read: ThreadReadResult =
        serde_json::from_value(payload).expect("turn must deserialize despite the unknown item");
    let items = read.thread.turns.unwrap_or_default().remove(0).items;

    assert_eq!(items.len(), 2);
    assert!(matches!(&items[0], ThreadItem::AgentMessage(m) if m.text == "before"));
    assert!(matches!(&items[1], ThreadItem::Sleep(s) if s.duration_ms == 10));
}
