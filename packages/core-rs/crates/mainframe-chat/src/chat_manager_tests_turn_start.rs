//! The daemon records one start per running turn (`ActiveChat.running_since_ms`)
//! and publishes it on `TurnStarted`, for resume to read back later.

use super::*;

fn started_at(events: &[ChatSurfaceEvent]) -> Vec<Option<i64>> {
    events
        .iter()
        .filter_map(|event| match event {
            ChatSurfaceEvent::TurnStarted { started_at_ms, .. } => Some(*started_at_ms),
            _ => None,
        })
        .collect()
}

fn ok_result() -> SessionResult {
    SessionResult {
        total_cost_usd: Some(0.0),
        usage: None,
        context_tokens: None,
        subtype: None,
        result: None,
        is_error: None,
    }
}

fn manager(chat: Chat) -> (ChatManager, Arc<RecordingSurface>) {
    let surface = RecordingSurface::arc();
    let mgr = ChatManager::new(FakeDeps::arc()).with_chat_surface(surface.clone());
    seed_active(&mgr, "c1", chat, RecSession::new("c1", true, true));
    (mgr, surface)
}

fn text(body: &str) -> MessageContent {
    MessageContent::Leaf(mainframe_types::content::LeafContent::Text {
        text: body.to_string(),
        parent_tool_use_id: None,
    })
}

#[tokio::test]
async fn a_send_records_the_start_and_publishes_the_same_value_resume_reads() {
    let (mgr, surface) = manager(working_chat("c1", Some("t"), false));
    assert_eq!(mgr.turn_started_at_ms("c1"), None);

    let before = now_ms();
    mgr.send_message("c1", "hello", None, None).await.unwrap();
    let after = now_ms();

    let recorded = mgr.turn_started_at_ms("c1").expect("start recorded");
    assert!(recorded >= before && recorded <= after);
    assert_eq!(started_at(&surface.events()), vec![Some(recorded)]);
}

#[tokio::test]
async fn a_follow_up_during_the_turn_does_not_move_the_start() {
    let (mgr, surface) = manager(working_chat("c1", Some("t"), false));
    mgr.send_message("c1", "first", None, None).await.unwrap();
    let recorded = mgr.turn_started_at_ms("c1").unwrap();

    // A queued prompt is accepted mid-turn: no new TurnStarted, no new stamp.
    mgr.send_message("c1", "second", None, None).await.unwrap();
    assert_eq!(mgr.turn_started_at_ms("c1"), Some(recorded));
    assert_eq!(started_at(&surface.events()), vec![Some(recorded)]);
}

#[tokio::test]
async fn going_idle_clears_the_start_so_the_next_turn_gets_its_own() {
    let (mgr, surface) = manager(working_chat("c1", Some("t"), false));
    let sink = mgr.event_handler.build_sink("c1", None);
    mgr.send_message("c1", "first", None, None).await.unwrap();
    assert!(mgr.turn_started_at_ms("c1").is_some());

    sink.on_result(ok_result());
    assert_eq!(mgr.turn_started_at_ms("c1"), None);

    mgr.send_message("c1", "again", None, None).await.unwrap();
    let events = surface.events();
    let starts = started_at(&events);
    assert_eq!(starts.len(), 2);
    assert_eq!(starts[1], mgr.turn_started_at_ms("c1"));
}

#[tokio::test]
async fn a_process_exit_clears_the_start() {
    let (mgr, _surface) = manager(working_chat("c1", Some("t"), false));
    mgr.send_message("c1", "first", None, None).await.unwrap();
    assert!(mgr.turn_started_at_ms("c1").is_some());

    mgr.event_handler.build_sink("c1", None).on_exit(Some(1));

    assert_eq!(mgr.turn_started_at_ms("c1"), None);
}

#[tokio::test]
async fn a_dequeued_prompt_starts_its_own_turn_after_the_previous_one_finished() {
    let (mgr, surface) = manager(working_chat("c1", Some("t"), true));
    mgr.send_message("c1", "queued", None, None).await.unwrap();
    let uuid = mgr.get_queued_for_chat("c1")[0].uuid.clone();
    let sink = mgr.event_handler.build_sink("c1", None);
    assert_eq!(mgr.turn_started_at_ms("c1"), None, "queued is not running");

    sink.on_queued_processed(&uuid);

    let recorded = mgr
        .turn_started_at_ms("c1")
        .expect("dequeue starts the turn");
    assert_eq!(started_at(&surface.events()), vec![Some(recorded)]);
}

#[tokio::test]
async fn a_turn_the_cli_starts_on_its_own_is_stamped_when_first_observed() {
    // Idle chat; the CLI begins a turn after a background-task notification and
    // its first assistant message is the daemon's first sign of it.
    let (mgr, surface) = manager(working_chat("c1", Some("t"), false));
    assert_eq!(mgr.turn_started_at_ms("c1"), None);

    let before = now_ms();
    let sink = mgr.event_handler.build_sink("c1", None);
    sink.on_message(vec![text("task finished")], None);
    let after = now_ms();

    let recorded = mgr.turn_started_at_ms("c1").expect("start observed");
    assert!(recorded >= before && recorded <= after);
    assert_eq!(started_at(&surface.events()), vec![Some(recorded)]);

    // Further messages in the same turn neither move it nor re-announce it.
    sink.on_message(vec![text("more")], None);
    assert_eq!(mgr.turn_started_at_ms("c1"), Some(recorded));
    assert_eq!(started_at(&surface.events()).len(), 1);
}
