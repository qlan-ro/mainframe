//! The projector holds each settled container once, and image payloads are
//! shared with the raw transcript rather than copied.
//!
//! `strong_count` on an image's `SharedStr` counts every structure holding the
//! block: the raw message plus each container copy the projector keeps. A
//! second projector copy (a materialized list beside the per-group state) or a
//! deep copy anywhere in conversion would raise it.

use super::harness::{assistant, duration_marker, tool_result_msg, tool_use, user};
use crate::display_pipeline::prepare_messages_for_client;
use crate::incremental::IncrementalProjector;
use crate::{DisplayProjector, ProjectionInput, RawChange, RawChanges};
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::content::{LeafContent, ToolResultImage};
use mainframe_types::display::{DisplayContent, DisplayMessage, DisplayNode};
use mainframe_types::shared_str::SharedStr;
use mainframe_types::tool_call_timing::ToolCallTiming;

fn image_message(id: &str, data: &SharedStr) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: "c".to_string(),
        r#type: ChatMessageType::User,
        content: vec![
            MessageContent::Leaf(LeafContent::Text {
                text: "look".to_string(),
                parent_tool_use_id: None,
            }),
            MessageContent::Leaf(LeafContent::Image {
                media_type: "image/png".to_string(),
                data: data.clone(),
                parent_tool_use_id: None,
            }),
        ],
        timestamp: format!("2026-01-01T00:00:00.{id}Z"),
        metadata: None,
    }
}

fn image_result(tool_id: &str, data: &SharedStr) -> MessageContent {
    MessageContent::Node(MessageContentNode::ToolResult {
        tool_use_id: tool_id.to_string(),
        content: "captured".to_string(),
        is_error: false,
        structured_patch: None,
        original_file: None,
        modified_file: None,
        images: vec![ToolResultImage {
            media_type: "image/png".to_string(),
            data: data.clone(),
            uri: None,
        }],
        parent_tool_use_id: None,
    })
}

fn timing() -> ToolCallTiming {
    ToolCallTiming {
        started_at: 1,
        completed_at: Some(5),
    }
}

fn project(
    projector: &mut IncrementalProjector,
    raw: &[ChatMessage],
    overlay: Option<&ChatMessage>,
    changes: Vec<RawChange>,
) -> Vec<DisplayMessage> {
    let delta = projector.project(ProjectionInput {
        raw,
        overlay,
        categories: None,
        changes: changes.into_iter().collect::<RawChanges>(),
    });
    let snapshot = delta.snapshot.materialize();
    let mut combined = raw.to_vec();
    combined.extend(overlay.cloned());
    assert_eq!(snapshot, prepare_messages_for_client(&combined, None));
    snapshot
}

/// Every image payload a display list carries, in order.
fn display_images(list: &[DisplayMessage]) -> Vec<SharedStr> {
    let mut out = Vec::new();
    for message in list {
        for block in &message.content {
            match block {
                DisplayContent::Leaf(LeafContent::Image { data, .. }) => out.push(data.clone()),
                DisplayContent::Node(DisplayNode::ToolCall {
                    result: Some(result),
                    ..
                }) => out.extend(result.images.iter().map(|image| image.data.clone())),
                _ => {}
            }
        }
    }
    out
}

#[test]
fn a_projected_prompt_image_is_held_by_the_raw_message_and_one_container() {
    let prompt = SharedStr::from("P".repeat(64 * 1024));
    let mut projector = IncrementalProjector::new();
    let mut raw = vec![image_message("m00001", &prompt)];
    let snapshot = project(&mut projector, &raw, None, vec![RawChange::Appended]);
    // The materialized copy shares the payload instead of copying it.
    assert!(display_images(&snapshot)[0].ptr_eq(&prompt));
    drop(snapshot);
    // `prompt` itself, the raw message, and the projector's one container.
    assert_eq!(prompt.strong_count(), 3);

    // Streaming, appends, and settling later turns never add a copy of the
    // settled container.
    let reply = assistant("m00002", vec![super::harness::text("one")]);
    project(&mut projector, &raw, Some(&reply), Vec::new());
    raw.push(reply);
    project(&mut projector, &raw, None, vec![RawChange::Appended]);
    raw.push(user("m00003", "next"));
    project(&mut projector, &raw, None, vec![RawChange::Appended]);
    assert_eq!(prompt.strong_count(), 3);
}

#[test]
fn in_place_patches_on_settled_groups_keep_a_single_container_copy() {
    let prompt = SharedStr::from("P".repeat(32 * 1024));
    let shot = SharedStr::from("S".repeat(32 * 1024));
    let mut projector = IncrementalProjector::new();
    let mut raw = vec![
        image_message("m00001", &prompt),
        assistant("m00002", vec![tool_use("toolu_1", "mcp__shot")]),
        tool_result_msg("m00003", vec![image_result("toolu_1", &shot)]),
    ];
    project(&mut projector, &raw, None, vec![RawChange::Appended]);

    // A later prompt settles the tool group behind it.
    raw.push(user("m00004", "thanks"));
    project(&mut projector, &raw, None, vec![RawChange::Appended]);

    // Timing patch on the settled tool group.
    if let MessageContent::Node(MessageContentNode::ToolUse { timing: slot, .. }) =
        &mut raw[1].content[0]
    {
        *slot = Some(timing());
    }
    project(
        &mut projector,
        &raw,
        None,
        vec![RawChange::Timing("toolu_1".to_string(), Some(timing()))],
    );

    // Nested re-conversion of the settled tool group.
    raw[1].content.push(super::harness::text("note"));
    project(&mut projector, &raw, None, vec![RawChange::Nested(1)]);

    // A turn-duration marker patching a settled assistant group in place: the
    // rewind starts at the trailing prompt, so the marker lands on the
    // assistant group an earlier call settled.
    raw.push(assistant("m00005", vec![super::harness::text("done")]));
    project(&mut projector, &raw, None, vec![RawChange::Appended]);
    raw.push(user("m00006", "and?"));
    project(&mut projector, &raw, None, vec![RawChange::Appended]);
    raw.push(duration_marker("m00007", 1200));
    let snapshot = project(&mut projector, &raw, None, vec![RawChange::Appended]);
    assert!(snapshot.iter().any(|message| {
        message
            .metadata
            .as_ref()
            .is_some_and(|meta| meta.contains_key("turnDurationMs"))
    }));
    let images = display_images(&snapshot);
    assert!(images.iter().any(|image| image.ptr_eq(&prompt)));
    assert!(images.iter().any(|image| image.ptr_eq(&shot)));
    drop((snapshot, images));

    assert_eq!(prompt.strong_count(), 3);
    // `shot` itself, the raw tool result, and the tool call's one container.
    assert_eq!(shot.strong_count(), 3);
}

#[test]
fn a_full_rebuild_after_a_category_change_keeps_a_single_copy() {
    let prompt = SharedStr::from("P".repeat(8 * 1024));
    let mut projector = IncrementalProjector::new();
    let raw = vec![
        image_message("m00001", &prompt),
        assistant("m00002", vec![super::harness::text("ok")]),
    ];
    project(&mut projector, &raw, None, vec![RawChange::Appended]);
    let categories = super::harness::task_categories();
    let delta = projector.project(ProjectionInput {
        raw: &raw,
        overlay: None,
        categories: Some(&categories),
        changes: RawChanges::default(),
    });
    assert!(delta.full);
    drop(delta);
    assert_eq!(prompt.strong_count(), 3);
}

/// Decoders that panic while a user message reading `boom` is converted.
struct PanicOnBoom(std::sync::atomic::AtomicBool);

impl crate::ToolResultDecoders for PanicOnBoom {
    fn parse_command(&self, text: &str) -> Option<crate::message_parsing::ParsedCommand> {
        let armed = self.0.load(std::sync::atomic::Ordering::SeqCst);
        assert!(!(armed && text == "boom"), "injected projection panic");
        None
    }
}

#[test]
fn a_panic_after_unparking_leaves_real_containers_and_forces_a_rebuild() {
    let prompt = SharedStr::from("P".repeat(16 * 1024));
    let shot = SharedStr::from("S".repeat(16 * 1024));
    let decoders = std::sync::Arc::new(PanicOnBoom(std::sync::atomic::AtomicBool::new(true)));
    let mut projector = IncrementalProjector::with_decoders(decoders.clone());
    let mut raw = vec![
        image_message("m00001", &prompt),
        assistant("m00002", vec![tool_use("toolu_1", "mcp__shot")]),
        tool_result_msg("m00003", vec![image_result("toolu_1", &shot)]),
        user("m00004", "thanks"),
    ];
    let first = projector.project(ProjectionInput {
        raw: &raw,
        overlay: None,
        categories: None,
        changes: [RawChange::Appended].into_iter().collect(),
    });
    let snapshot = first.snapshot.clone();
    let settled_ids: Vec<String> =
        snapshot.read(|list| list.iter().map(|m| m.id.clone()).collect());
    drop(first);

    // The timing entry unparks the settled tool group; folding the appended
    // `boom` prompt then panics with that container moved out.
    raw.push(user("m00005", "boom"));
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        projector.project(ProjectionInput {
            raw: &raw,
            overlay: None,
            categories: None,
            changes: [
                RawChange::Timing("toolu_1".to_string(), Some(timing())),
                RawChange::Appended,
            ]
            .into_iter()
            .collect(),
        })
    }));
    assert!(outcome.is_err(), "the injected panic fired");

    // A reader recovering the poisoned lock sees the settled containers, not
    // placeholders, with the images still shared.
    let ids_after: Vec<String> = snapshot.read(|list| list.iter().map(|m| m.id.clone()).collect());
    assert_eq!(ids_after, settled_ids);
    let images = snapshot.read(display_images);
    assert!(images.iter().any(|image| image.ptr_eq(&prompt)));
    assert!(images.iter().any(|image| image.ptr_eq(&shot)));
    drop(images);

    // The next call rebuilds in full and matches the full pipeline.
    decoders.0.store(false, std::sync::atomic::Ordering::SeqCst);
    let delta = projector.project(ProjectionInput {
        raw: &raw,
        overlay: None,
        categories: None,
        changes: [RawChange::Appended].into_iter().collect(),
    });
    assert!(delta.full);
    assert_eq!(
        delta.snapshot.materialize(),
        prepare_messages_for_client(&raw, None)
    );
    drop(delta);
    assert_eq!(prompt.strong_count(), 3);
    assert_eq!(shot.strong_count(), 3);
}
