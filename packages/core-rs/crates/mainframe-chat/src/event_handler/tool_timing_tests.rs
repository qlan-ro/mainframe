use super::stable_id_characterization_tests::ShapeDeps;
use super::*;
use crate::message_cache::timing_tests::{result, timings, tool};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicU64, Ordering};

struct Fixture {
    handler: EventHandler<ShapeDeps>,
    messages: Arc<Mutex<MessageCache>>,
    permissions: Arc<Mutex<PermissionManager>>,
    clock: Arc<AtomicU64>,
}

impl Fixture {
    fn new() -> Self {
        let clock = Arc::new(AtomicU64::new(1000));
        let now = clock.clone();
        let messages = Arc::new(Mutex::new(MessageCache::with_clock(Arc::new(move || {
            now.load(Ordering::SeqCst)
        }))));
        let permissions = Arc::new(Mutex::new(PermissionManager::new()));
        let handler = EventHandler::new(messages.clone(), permissions.clone(), ShapeDeps::new());
        Self {
            handler,
            messages,
            permissions,
            clock,
        }
    }

    fn sink(&self, session: &str) -> Arc<dyn SessionSink> {
        self.handler.build_sink("chat-shape", Some(session.into()))
    }

    fn at(&self, time: u64) {
        self.clock.store(time, Ordering::SeqCst);
    }

    fn timings(&self) -> Vec<Value> {
        timings(&self.messages.lock().unwrap(), "chat-shape")
    }
}

fn turn(error: bool) -> SessionResult {
    serde_json::from_value(json!({"subtype":if error { "error_during_execution" } else { "success" }, "isError":error})).unwrap()
}

#[test]
fn tool_timing_sink_stamps_independent_calls_and_preserves_duplicate_callbacks() {
    let fixture = Fixture::new();
    let sink = fixture.sink("s1");
    sink.on_message(vec![tool("a")], None);
    fixture.at(1100);
    sink.on_message(vec![tool("b")], None);
    fixture.at(1200);
    sink.on_tool_result(vec![result("a", false)], None);
    fixture.at(1300);
    sink.on_tool_result(vec![result("b", true)], None);
    let expected = vec![
        json!({"startedAt":1000,"completedAt":1200}),
        json!({"startedAt":1100,"completedAt":1300}),
    ];
    assert_eq!(fixture.timings(), expected);
    fixture.at(9000);
    sink.on_message(vec![tool("a"), tool("b")], None);
    sink.on_tool_result(vec![result("a", false), result("b", true)], None);
    assert_eq!(fixture.timings(), [expected.clone(), expected].concat());
}

#[test]
fn tool_timing_sink_nested_parent_and_mixed_children_keep_independent_lifecycles() {
    let fixture = Fixture::new();
    let sink = fixture.sink("s1");
    sink.on_message(vec![tool("parent")], None);
    fixture.at(1100);
    sink.on_subagent_child(
        "parent",
        vec![
            result("early", false),
            tool("early"),
            tool("child"),
            result("child", false),
            tool("background"),
        ],
    );
    fixture.at(1200);
    sink.on_tool_result(vec![result("parent", false)], None);
    sink.on_result(turn(false));
    assert_eq!(
        fixture.timings(),
        vec![
            json!({"startedAt":1000,"completedAt":1200}),
            Value::Null,
            json!({"startedAt":1100,"completedAt":1100}),
            json!({"startedAt":1100})
        ]
    );
    fixture.at(1300);
    sink.on_subagent_child("parent", vec![result("background", false)]);
    assert_eq!(
        fixture.timings()[3],
        json!({"startedAt":1100,"completedAt":1300})
    );
}

#[test]
fn tool_timing_sink_replacement_and_stale_exit_cannot_finish_new_sessions_calls() {
    let fixture = Fixture::new();
    let old = fixture.sink("old");
    old.on_message(vec![tool("a")], None);
    fixture.at(1100);
    let resumed = fixture.sink("old");
    resumed.on_message(vec![tool("a")], None);
    let cell = fixture.handler.deps.get_active_chat("chat-shape").unwrap();
    cell.lock().unwrap().session = Some(Arc::new(crate::test_support::FakeSession::spawned()));
    let new = fixture.sink("sess");
    new.on_message(vec![tool("b")], None);
    fixture.at(1200);
    old.on_exit(Some(1));
    assert_eq!(
        cell.lock().unwrap().chat.process_state,
        Some(Some(ProcessState::Working))
    );
    assert_eq!(
        fixture.timings(),
        vec![json!({"startedAt":1000,"completedAt":1200}); 2]
            .into_iter()
            .chain([json!({"startedAt":1100})])
            .collect::<Vec<_>>()
    );
    fixture.at(1300);
    new.on_tool_result(vec![result("b", false)], None);
    assert_eq!(
        fixture.timings()[2],
        json!({"startedAt":1100,"completedAt":1300})
    );
}

#[test]
fn tool_timing_sink_cancel_and_error_finish_without_result_bodies() {
    for interrupted in [false, true] {
        let fixture = Fixture::new();
        let sink = fixture.sink("s1");
        sink.on_message(vec![tool("a")], None);
        if interrupted {
            fixture
                .permissions
                .lock()
                .unwrap()
                .mark_interrupted("chat-shape");
        }
        fixture.at(1200);
        sink.on_result(turn(!interrupted));
        assert_eq!(
            fixture.timings(),
            vec![json!({"startedAt":1000,"completedAt":1200})]
        );
        let messages = fixture.messages.lock().unwrap();
        assert!(
            messages
                .get("chat-shape")
                .unwrap()
                .iter()
                .flat_map(|m| &m.content)
                .all(|block| !matches!(
                    block,
                    MessageContent::Node(MessageContentNode::ToolResult { .. })
                ))
        );
    }
}

#[test]
fn tool_timing_sink_diagnostic_retry_and_cancel_intent_do_not_finish_calls() {
    let fixture = Fixture::new();
    let sink = fixture.sink("s1");
    sink.on_message(vec![tool("a")], None);
    fixture.at(1200);
    sink.on_error(mainframe_adapter_api::AdapterError::Message(
        "retryable".into(),
    ));
    sink.on_api_retry(1, None);
    fixture
        .permissions
        .lock()
        .unwrap()
        .mark_interrupted("chat-shape");
    assert_eq!(fixture.timings(), vec![json!({"startedAt":1000})]);
    fixture.at(900);
    sink.on_tool_result(vec![result("a", false)], None);
    assert_eq!(
        fixture.timings(),
        vec![json!({"startedAt":1000,"completedAt":1000})]
    );
}

struct TimingSurface {
    messages: Arc<Mutex<MessageCache>>,
    events: Mutex<Vec<(&'static str, Vec<Value>)>>,
}

impl ChatSurface for TimingSurface {
    fn on_chat_surface_event(&self, event: ChatSurfaceEvent) {
        let name = match event {
            ChatSurfaceEvent::DisplayRevision { .. } => "display",
            ChatSurfaceEvent::TurnFinished { .. } => "finished",
            _ => return,
        };
        let snapshot = if name == "finished" {
            timings(&self.messages.lock().unwrap(), "chat-shape")
        } else {
            Vec::new()
        };
        self.events.lock().unwrap().push((name, snapshot));
    }
}

#[test]
fn tool_timing_sink_publishes_completion_before_terminal_notification() {
    let fixture = Fixture::new();
    let surface = Arc::new(TimingSurface {
        messages: fixture.messages.clone(),
        events: Mutex::new(Vec::new()),
    });
    fixture.handler.set_chat_surface(surface.clone());
    let sink = fixture.sink("s1");
    sink.on_message(vec![tool("a")], None);
    fixture.at(1200);
    sink.on_result(turn(true));
    let events = surface.events.lock().unwrap();
    let completed = vec![json!({"startedAt":1000,"completedAt":1200})];
    let finished = events
        .iter()
        .position(|(name, _)| *name == "finished")
        .unwrap();
    assert_eq!(
        events[..finished]
            .iter()
            .filter(|(name, _)| *name == "display")
            .count(),
        2
    );
    assert_eq!(events[finished].1, completed);
}
