//! Task 14 (group D, todo #350): end-to-end proof, over a real `ChatManager`,
//! that the chat-surface seam (task 10) carries the two prompt-lifecycle
//! criteria the facade's `session/prompt`/`session/cancel` dispatch (plan
//! task 14, `mainframe-acp/src/prompt.rs`) relies on:
//!
//! - criterion 5: a prompt accepted while another turn is running is
//!   `TurnAccepted` immediately but not `TurnStarted` until the CLI actually
//!   dequeues it (no facade `queue.*` frame family needed — the daemon side
//!   of that guarantee is this gap between the two events).
//! - criterion 6: `interrupt_chat` (what a `session/cancel` port impl calls)
//!   ends the turn with a cancelled stop reason and leaves no answerable gate
//!   behind.
//!
//! `mainframe-acp`'s own `PromptPort`/`dispatch_prompt`/`dispatch_cancel`
//! tests cover the wire-frame shape with a hand-written fake port; a full
//! `ChatManagerDeps` fake wired into that crate as a dev-dependency was
//! judged disproportionate to this task's verification bar (no existing
//! reusable harness — `StoreDeps` here is private to this module) — see the
//! implementer's decisions.

use super::*;
use crate::chat_surface::{ChatSurface, ChatSurfaceEvent, TurnStopReason};
use mainframe_types::adapter::{ControlBehavior, ControlRequest, SessionResult};

#[derive(Default)]
struct RecordingSurface {
    events: Mutex<Vec<ChatSurfaceEvent>>,
}

impl RecordingSurface {
    fn arc() -> Arc<Self> {
        Arc::new(Self::default())
    }
    fn events(&self) -> Vec<ChatSurfaceEvent> {
        self.events.lock().unwrap().clone()
    }
}

impl ChatSurface for RecordingSurface {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        self.events.lock().unwrap().push(event);
    }
}

fn has_turn_started(events: &[ChatSurfaceEvent]) -> bool {
    events
        .iter()
        .any(|e| matches!(e, ChatSurfaceEvent::TurnStarted { .. }))
}

#[tokio::test]
async fn a_queued_prompt_is_accepted_immediately_but_not_started_until_dequeued() {
    let deps = StoreDeps::arc();
    let surface = RecordingSurface::arc();
    let mgr = ChatManager::new(deps).with_chat_surface(surface.clone());
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        RecSession::new("c1", true, true),
    );

    mgr.send_message("c1", "hello while busy", None, None)
        .await
        .unwrap();

    assert!(
        surface
            .events()
            .iter()
            .any(|e| matches!(e, ChatSurfaceEvent::TurnAccepted { .. })),
        "accepted immediately"
    );
    assert!(
        !has_turn_started(&surface.events()),
        "must not start until the CLI dequeues it"
    );

    let uuid = mgr.get_queued_for_chat("c1")[0].uuid.clone();
    let sink = mgr.event_handler.build_sink("c1", None);
    sink.on_queued_processed(&uuid);

    assert!(
        has_turn_started(&surface.events()),
        "started once the CLI reports the queued message dequeued"
    );
}

#[tokio::test]
async fn a_command_sent_mid_turn_reports_no_queue_position() {
    let deps = StoreDeps::arc();
    let surface = RecordingSurface::arc();
    let mgr = ChatManager::new(deps).with_chat_surface(surface.clone());
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        RecSession::new("c1", true, true),
    );

    mgr.send_message(
        "c1",
        "/compact",
        None,
        Some(CommandMeta {
            name: "compact".to_string(),
            source: "claude".to_string(),
            args: None,
        }),
    )
    .await
    .unwrap();

    assert!(
        !has_turn_started(&surface.events()),
        "a command sent while a turn is already running must not re-announce TurnStarted: {:?}",
        surface.events()
    );
    assert_eq!(
        mgr.queued_message_count("c1"),
        0,
        "commands bypass the queue — a mid-turn command must not appear queued"
    );
}

#[tokio::test]
async fn queue_changes_announce_full_snapshots_on_the_seam() {
    let deps = StoreDeps::arc();
    let surface = RecordingSurface::arc();
    let mgr = ChatManager::new(deps).with_chat_surface(surface.clone());
    let session = RecSession::new("c1", true, true);
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        session.clone(),
    );

    mgr.send_message("c1", "hello while busy", None, None)
        .await
        .unwrap();

    let snapshots = |surface: &RecordingSurface| -> Vec<Vec<String>> {
        surface
            .events()
            .iter()
            .filter_map(|e| match e {
                ChatSurfaceEvent::QueueChanged { refs, .. } => {
                    Some(refs.iter().map(|r| r.content.clone()).collect())
                }
                _ => None,
            })
            .collect()
    };
    assert_eq!(
        snapshots(&surface),
        vec![vec!["hello while busy".to_string()]],
        "enqueue announces the full snapshot"
    );

    mgr.send_message("c1", "second in line", None, None)
        .await
        .unwrap();
    assert_eq!(
        snapshots(&surface).last(),
        Some(&vec![
            "hello while busy".to_string(),
            "second in line".to_string()
        ]),
        "snapshots are oldest-first (FIFO), whatever the map iteration order"
    );

    let r = mgr.get_queued_for_chat("c1")[0].clone();
    mgr.cancel_queued_message("c1", &r.message_id)
        .await
        .unwrap();

    assert_eq!(
        snapshots(&surface).last(),
        Some(&vec!["second in line".to_string()]),
        "cancel announces the remaining snapshot"
    );
}

#[tokio::test]
async fn interrupt_ends_the_turn_cancelled_and_leaves_no_answerable_gate() {
    let deps = StoreDeps::arc();
    let surface = RecordingSurface::arc();
    let mgr = ChatManager::new(deps).with_chat_surface(surface.clone());
    seed_active(
        &mgr,
        "c1",
        working_chat("c1", Some("t"), true),
        RecSession::new("c1", false, true),
    );
    let sink = mgr.event_handler.build_sink("c1", None);
    sink.on_permission(ControlRequest {
        request_id: "req_1".to_string(),
        tool_name: "Bash".to_string(),
        tool_use_id: "toolu_1".to_string(),
        input: HashMap::new(),
        suggestions: Vec::new(),
        decision_reason: None,
        options: None,
    });
    assert!(
        surface
            .events()
            .iter()
            .any(|e| matches!(e, ChatSurfaceEvent::GateRaised { .. }))
    );

    mgr.interrupt_chat("c1").await;
    // The CLI's SIGINT-triggered result arrives after the interrupt.
    sink.on_result(SessionResult {
        total_cost_usd: Some(0.0),
        usage: None,
        context_tokens: None,
        subtype: None,
        result: None,
        is_error: None,
    });

    assert!(
        surface.events().iter().any(|e| matches!(
            e,
            ChatSurfaceEvent::TurnFinished {
                stop_reason: TurnStopReason::Cancelled,
                ..
            }
        )),
        "interrupt_chat's mark_interrupted flows into on_result's stop reason"
    );

    // The gate `interrupt_chat` cleared is no longer tracked: cancelling it
    // now is a no-op (`CancelOutcome::Unknown`), so no second `GateResolved`
    // follows the raise.
    sink.on_permission_cancelled("req_1");
    let resolved_count = surface
        .events()
        .iter()
        .filter(|e| matches!(e, ChatSurfaceEvent::GateResolved { .. }))
        .count();
    assert_eq!(resolved_count, 0, "interrupt_chat already cleared the gate");
}

mod lifecycle_tests;
