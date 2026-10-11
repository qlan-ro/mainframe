#[derive(Default)]
struct StorageSurface(Mutex<Vec<ChatSurfaceEvent>>);
impl ChatSurface for StorageSurface {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        self.0.lock().unwrap().push(event);
    }
}
fn failing_harness() -> (Harness, Arc<Mutex<ActiveChat>>, Arc<StorageSurface>) {
    let cell = cell_named("chat-1", ProcessState::Working, Some(now_ms() - 100));
    let h = Harness::new(cell.clone());
    *h.deps.store.write_failure.lock().unwrap() = Some("private sqlite error".into());
    let surface = Arc::new(StorageSurface::default());
    h.handler.set_chat_surface(surface.clone());
    (h, cell, surface)
}
#[test]
fn failed_result_write_still_finishes_turn_and_emits_timing() {
    let (h, cell, surface) = failing_harness();
    *h.deps.push.task_complete.lock().unwrap() = true;
    let mut result = result("success", Some(false));
    result.total_cost_usd = Some(1.25);
    h.sink("chat-1").on_result(result);
    assert_storage_events(&h.deps.events(), &["error", "chat.updated", "chat.notification"]);
    let chat = cell.lock().unwrap().chat.clone();
    assert_eq!(chat.process_state, Some(Some(ProcessState::Idle)));
    assert_eq!(chat.total_cost, 1.25);
    assert!(cell.lock().unwrap().turn_started_at.is_none());
    assert!(h.deps.events().iter().any(|e| matches!(e, DaemonEvent::ChatNotification { .. })));
    assert!(surface.0.lock().unwrap().iter().any(|e| matches!(e,
        ChatSurfaceEvent::TurnFinished { stop_reason: TurnStopReason::Completed, .. })));
    assert!(h.deps.events().iter().any(|e| matches!(e, DaemonEvent::ChatUpdated {
        reason: Some(ChatUpdatedReason::Completed), .. })));
    assert!(h.deps.events().iter().any(|e| matches!(e, DaemonEvent::Error {
        chat_id: Some(id), error } if id == "chat-1" && error == "Chat storage operation failed")));
}
#[test]
fn failed_exit_write_still_emits_updated_finished_and_stopped() {
    let (h, cell, surface) = failing_harness();
    h.sink("chat-1").on_exit(Some(1));
    assert_storage_events(&h.deps.events(), &["error", "chat.updated", "process.stopped"]);
    assert_eq!(cell.lock().unwrap().chat.process_state, Some(None));
    assert!(surface.0.lock().unwrap().iter().any(|e| matches!(e,
        ChatSurfaceEvent::TurnFinished { stop_reason: TurnStopReason::Error, .. })));
    assert!(h.deps.events().iter().any(|e| matches!(e, DaemonEvent::ChatUpdated { .. })));
    assert!(h.deps.events().iter().any(|e| matches!(e, DaemonEvent::ProcessStopped { .. })));
}
#[test]
fn failed_metadata_writes_preserve_live_updates_and_rate_limit_errors() {
    let (h, cell, surface) = failing_harness();
    let sink = h.sink("chat-1");
    sink.on_init("native-session");
    sink.on_todo_update(Vec::new());
    sink.on_context_usage(ContextUsage { percentage: 42.0, total_tokens: 420, max_tokens: 1000 });
    let chat = cell.lock().unwrap().chat.clone();
    assert_eq!(chat.claude_session_id.as_deref(), Some("native-session"));
    assert_eq!(chat.todos, Some(Vec::new()));
    assert_eq!(chat.last_context_total_tokens, Some(420));
    let events = h.deps.events();
    assert_storage_events(&events, &["error", "process.ready", "todos.updated", "chat.updated"]);
    assert!(events.iter().any(|e| matches!(e, DaemonEvent::ProcessReady { .. })));
    assert!(events.iter().any(|e| matches!(e, DaemonEvent::TodosUpdated { .. })));
    assert_eq!(events.iter().filter(|e| matches!(e, DaemonEvent::Error { .. })).count(), 1);
    assert!(surface.0.lock().unwrap().iter().any(|e| matches!(e,
        ChatSurfaceEvent::Usage { usage, .. } if usage.total_tokens == 420)));
}

#[test]
fn failed_message_state_writes_emit_working_and_plan_mode() {
    let (h, cell, _) = failing_harness();
    cell.lock().unwrap().chat.process_state = Some(Some(ProcessState::Idle));
    let tool: MessageContent = serde_json::from_value(serde_json::json!({
        "type": "tool_use", "id": "tool-1", "name": "EnterPlanMode", "input": {}
    })).unwrap();
    h.sink("chat-1").on_message(vec![tool], None);
    let events = h.deps.events();
    assert!(matches!(&events[0], DaemonEvent::Error { chat_id: Some(id), .. } if id == "chat-1"));
    assert!(matches!(&events[1], DaemonEvent::ChatUpdated { chat, .. } if chat.process_state == Some(Some(ProcessState::Working))));
    assert!(matches!(&events[2], DaemonEvent::ChatUpdated { chat, .. } if chat.plan_mode == Some(true)));
}

fn assert_storage_events(events: &[DaemonEvent], expected: &[&str]) {
    let tags: Vec<String> = events.iter().map(|e| serde_json::to_value(e).unwrap()["type"].as_str().unwrap().to_string()).collect();
    assert_eq!(tags, expected);
    assert!(events.iter().any(|e| matches!(e, DaemonEvent::Error { chat_id: Some(id), error } if id == "chat-1" && error == "Chat storage operation failed")));
}
