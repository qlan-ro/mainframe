#[tokio::test]
async fn no_pending_gate_means_no_redelivered_request() {
    let port = FakePort::default();
    let (_response, replay) = dispatch_resume(resume_request(None), &port, None).await;
    assert!(replay.pending_permission_request.is_none());
}

#[tokio::test]
async fn missing_params_gets_invalid_params() {
    let request = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        id: Some(RequestId::Number(1)),
        method: "session/resume".to_string(),
        params: None,
    };
    let port = FakePort::default();
    let (response, replay) = dispatch_resume(request, &port, None).await;
    assert!(matches!(
        response.outcome,
        mainframe_types::acp::jsonrpc::JsonRpcOutcome::Error { .. }
    ));
    assert!(replay.updates.is_empty());
}

#[tokio::test]
async fn resume_replay_ends_with_the_current_turn_state() {
    let running_port = FakePort {
        messages: vec![dmsg("dmsg_1", vec![text("hello")])],
        running: true,
        ..FakePort::default()
    };
    let (_response, replay) = dispatch_resume(resume_request(None), &running_port, None).await;
    assert!(matches!(
        replay.updates.last(),
        Some(SessionUpdate::StateUpdate(WireSessionState::Running))
    ));

    let idle_port = FakePort {
        messages: vec![dmsg("dmsg_1", vec![text("hello")])],
        ..FakePort::default()
    };
    let (_response, replay) = dispatch_resume(resume_request(None), &idle_port, None).await;
    assert!(matches!(
        replay.updates.last(),
        Some(SessionUpdate::StateUpdate(WireSessionState::Idle(idle))) if idle.stop_reason.is_none()
    ));
}

// Overlay-parity streaming-attribution tests live in `overlay_streaming.rs`,
// split out to keep this file under 300 lines.
#[path = "resume_tests_overlay_streaming.rs"]
mod overlay_streaming;
// End-to-end revision-cursor tests live in `revision_cursor_tests.rs`, split
// out for the same reason.
#[path = "resume_tests_revision_cursor_tests.rs"]
mod revision_cursor_tests;

// ── Replay result previews ───────────────────────────────────────────────────

fn tool_call_message(id: &str, result: &str) -> DisplayMessage {
    use mainframe_types::display::{DisplayNode, ToolCallResult, ToolCategory};
    dmsg(
        id,
        vec![DisplayContent::Node(DisplayNode::ToolCall {
            timing: None,
            command_execution: None,
            id: format!("{id}-tool"),
            name: "Read".to_string(),
            input: HashMap::new(),
            category: ToolCategory::Default,
            result: Some(ToolCallResult {
                content: result.to_string(),
                is_error: false,
                structured_patch: None,
                original_file: None,
                modified_file: None,
                truncated: None,
                full_bytes: None,
                ask_user_question: None,
                images: Vec::new(),
            }),
            parent_tool_use_id: None,
        })],
    )
}

fn replayed_result_lengths(replay: &ResumeReplay) -> Vec<(String, usize, bool)> {
    replay
        .updates
        .iter()
        .filter_map(|update| match update {
            SessionUpdate::ToolCallUpdate(patch) => {
                let content = patch.content.as_ref()?.as_ref()?;
                let mainframe_types::acp::tool_call::ToolCallContent::Content {
                    content: mainframe_types::acp::content::ContentBlock::Text { text, meta },
                } = &content[0]
                else {
                    return None;
                };
                let marked = meta
                    .as_ref()
                    .and_then(|m| m.get(MAINFRAME_META_NAMESPACE))
                    .and_then(|ns| ns.get("truncated"))
                    == Some(&json!(true));
                Some((patch.tool_call_id.clone(), text.len(), marked))
            }
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn an_opted_in_full_replay_previews_old_results_and_keeps_the_newest_full() {
    use crate::replay_previews::{FULL_RESULT_CONTAINERS, PREVIEW_BYTES};
    let big = "r".repeat(PREVIEW_BYTES * 3);
    let mut messages = vec![tool_call_message("old", &big)];
    for i in 0..FULL_RESULT_CONTAINERS {
        messages.push(tool_call_message(&format!("new{i}"), &big));
    }
    let port = FakePort {
        messages,
        ..FakePort::default()
    };

    let (_response, replay) = dispatch_resume_with(
        resume_request(Some(json!({ "type": "start" }))),
        &port,
        None,
        ResumeOptions {
            result_previews: true,
            ..ResumeOptions::default()
        },
    )
    .await;

    let lengths = replayed_result_lengths(&replay);
    assert_eq!(lengths[0], ("old-tool".to_string(), PREVIEW_BYTES, true));
    assert!(
        lengths[1..]
            .iter()
            .all(|(_, len, marked)| *len == PREVIEW_BYTES * 3 && !marked),
        "{lengths:?}"
    );
    assert_eq!(
        replay.preview_ids,
        std::collections::HashSet::from(["old-tool".to_string()])
    );
}

#[tokio::test]
async fn a_connection_that_did_not_opt_in_replays_every_result_in_full() {
    use crate::replay_previews::{FULL_RESULT_CONTAINERS, PREVIEW_BYTES};
    let big = "r".repeat(PREVIEW_BYTES * 3);
    let mut messages = vec![tool_call_message("old", &big)];
    for i in 0..FULL_RESULT_CONTAINERS {
        messages.push(tool_call_message(&format!("new{i}"), &big));
    }
    let port = FakePort {
        messages,
        ..FakePort::default()
    };

    let (_response, replay) = dispatch_resume(
        resume_request(Some(json!({ "type": "start" }))),
        &port,
        None,
    )
    .await;

    let lengths = replayed_result_lengths(&replay);
    assert!(
        lengths
            .iter()
            .all(|(_, len, marked)| *len == PREVIEW_BYTES * 3 && !marked),
        "{lengths:?}"
    );
    assert!(replay.preview_ids.is_empty());
}

#[tokio::test]
async fn a_cursor_replay_previews_nothing_new() {
    use crate::replay_previews::{FULL_RESULT_CONTAINERS, PREVIEW_BYTES};
    let big = "r".repeat(PREVIEW_BYTES * 3);
    let mut messages = vec![tool_call_message("old", &big)];
    for i in 0..FULL_RESULT_CONTAINERS {
        messages.push(tool_call_message(&format!("new{i}"), &big));
    }
    let port = FakePort {
        messages,
        ..FakePort::default()
    };

    let (_response, replay) = dispatch_resume_with(
        resume_request(Some(json!({ "type": "item", "itemId": "old-tool" }))),
        &port,
        None,
        ResumeOptions {
            result_previews: true,
            ..ResumeOptions::default()
        },
    )
    .await;

    // Only the items after the cursor replay, all newest, all full.
    let lengths = replayed_result_lengths(&replay);
    assert_eq!(lengths.len(), FULL_RESULT_CONTAINERS);
    assert!(
        lengths
            .iter()
            .all(|(id, len, marked)| id != "old-tool" && *len == PREVIEW_BYTES * 3 && !marked)
    );
}
