use std::sync::{Arc, Mutex};

use mainframe_display::{
    DisplayDelta, DisplayProjector, DisplaySnapshot, ProjectionStats, RawChange,
};
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
use mainframe_types::content::LeafContent;

use super::super::MessageCache;

/// Records the `RawChange`s it was handed on each `project` call (one
/// `Vec<RawChange>` per call, in order) and always answers with an empty
/// incremental delta — never `Full` — so a projector swap is observable.
#[derive(Clone, Default)]
struct RecordingProjector {
    calls: Arc<Mutex<Vec<Vec<RawChange>>>>,
}

impl RecordingProjector {
    fn new() -> Self {
        Self::default()
    }

    fn calls(&self) -> Vec<Vec<RawChange>> {
        self.calls.lock().unwrap().clone()
    }
}

impl DisplayProjector for RecordingProjector {
    fn project(&mut self, mut input: mainframe_display::ProjectionInput<'_>) -> DisplayDelta {
        let drained = input.changes.drain();
        self.calls.lock().unwrap().push(drained);
        DisplayDelta {
            full: false,
            changes: Vec::new(),
            len: input.raw.len(),
            snapshot: DisplaySnapshot::new(Vec::new()),
            stats: ProjectionStats::default(),
        }
    }
}

/// Always answers `Full` — used as the `make_projector` fallback on the
/// assertion call after a lifecycle mutation, so a dropped slot is
/// observable (a surviving slot would keep answering through its original
/// `RecordingProjector` instead, which never reports `full`).
struct AlwaysFullProjector;

impl DisplayProjector for AlwaysFullProjector {
    fn project(&mut self, input: mainframe_display::ProjectionInput<'_>) -> DisplayDelta {
        DisplayDelta {
            full: true,
            changes: Vec::new(),
            len: input.raw.len(),
            snapshot: DisplaySnapshot::new(Vec::new()),
            stats: ProjectionStats {
                raw_folded: input.raw.len(),
                full_rebuilds: 1,
                ..ProjectionStats::default()
            },
        }
    }
}

fn msg(id: &str) -> ChatMessage {
    ChatMessage {
        id: id.to_string(),
        chat_id: "c1".to_string(),
        r#type: ChatMessageType::User,
        content: vec![MessageContent::Leaf(LeafContent::Text {
            text: id.to_string(),
            parent_tool_use_id: None,
        })],
        timestamp: "t".to_string(),
        metadata: None,
    }
}

/// Create `chat_id`'s projection slot with a `RecordingProjector`, consuming
/// its first (necessarily empty) call, and return the handle so a test can
/// inspect every later call's journal.
fn seed(cache: &mut MessageCache, chat_id: &str) -> RecordingProjector {
    let recorder = RecordingProjector::new();
    let boxed = recorder.clone();
    cache.project_display(chat_id, None, None, move || Box::new(boxed));
    recorder
}

/// Advance `chat_id`'s projection and return whether the result is `Full`.
/// The `make_projector` fallback only runs when no slot exists, so this
/// doubles as "was the slot dropped?" when called right after a lifecycle
/// mutation on a chat `seed` previously populated.
fn is_next_full(cache: &mut MessageCache, chat_id: &str) -> bool {
    cache
        .project_display(chat_id, None, None, || Box::new(AlwaysFullProjector))
        .full
}

#[test]
fn append_records_an_appended_entry() {
    let mut cache = MessageCache::new();
    let recorder = seed(&mut cache, "c1");
    cache.append("c1", msg("a"));
    let delta = cache.project_display("c1", None, None, || {
        panic!("the slot already exists; make_projector must not run")
    });
    assert!(!delta.full);
    assert_eq!(
        recorder.calls(),
        vec![Vec::new(), vec![RawChange::Appended]]
    );
}

#[test]
fn append_live_records_an_appended_entry() {
    let mut cache = MessageCache::new();
    let recorder = seed(&mut cache, "c1");
    cache.append_live("c1", "session-1", msg("a"));
    cache.project_display("c1", None, None, || unreachable!());
    assert_eq!(recorder.calls()[1], vec![RawChange::Appended]);
}

#[test]
fn append_nested_live_records_a_nested_entry_at_the_parents_index() {
    let mut cache = MessageCache::new();
    let parent = ChatMessage {
        id: "p1".to_string(),
        chat_id: "c1".to_string(),
        r#type: ChatMessageType::Assistant,
        content: vec![MessageContent::Node(MessageContentNode::ToolUse {
            id: "tool-1".to_string(),
            name: "Task".to_string(),
            input: Default::default(),
            timing: None,
            command_execution: None,
            parent_tool_use_id: None,
        })],
        timestamp: "t".to_string(),
        metadata: None,
    };
    cache.append("c1", msg("u0"));
    cache.append("c1", parent);
    let recorder = seed(&mut cache, "c1");

    let appended = cache.append_nested_live(
        "c1",
        "session-1",
        "tool-1",
        vec![MessageContent::Leaf(LeafContent::Text {
            text: "child output".to_string(),
            parent_tool_use_id: Some("tool-1".to_string()),
        })],
    );
    assert!(appended);

    cache.project_display("c1", None, None, || unreachable!());
    assert_eq!(recorder.calls()[1], vec![RawChange::Nested(1)]);
}

#[test]
fn remove_by_id_records_a_structural_entry_at_the_removed_index() {
    let mut cache = MessageCache::new();
    cache.append("c1", msg("a"));
    cache.append("c1", msg("b"));
    cache.append("c1", msg("c"));
    let recorder = seed(&mut cache, "c1");

    assert!(cache.remove_by_id("c1", "b"));

    cache.project_display("c1", None, None, || unreachable!());
    assert_eq!(recorder.calls()[1], vec![RawChange::Structural(1)]);
}

#[test]
fn move_to_end_records_a_structural_entry_at_the_moved_index() {
    let mut cache = MessageCache::new();
    cache.append("c1", msg("a"));
    cache.append("c1", msg("b"));
    cache.append("c1", msg("c"));
    let recorder = seed(&mut cache, "c1");

    assert!(cache.move_to_end("c1", "a"));

    cache.project_display("c1", None, None, || unreachable!());
    assert_eq!(recorder.calls()[1], vec![RawChange::Structural(0)]);
}

#[test]
fn strip_queued_and_move_to_end_records_a_structural_entry_without_cloning() {
    let mut cache = MessageCache::new();
    let mut queued = msg("q1");
    let mut md = std::collections::HashMap::new();
    md.insert("queued".to_string(), serde_json::Value::Bool(true));
    md.insert(
        "uuid".to_string(),
        serde_json::Value::String("u1".to_string()),
    );
    queued.metadata = Some(md);
    cache.append("c1", msg("a"));
    cache.append("c1", queued);
    let recorder = seed(&mut cache, "c1");

    assert!(cache.strip_queued_and_move_to_end("c1", "q1"));
    let ids: Vec<String> = cache
        .get("c1")
        .unwrap()
        .iter()
        .map(|m| m.id.clone())
        .collect();
    assert_eq!(ids, vec!["a".to_string(), "q1".to_string()]);
    assert!(
        !cache.get("c1").unwrap()[1]
            .metadata
            .as_ref()
            .is_some_and(|md| md.contains_key("queued")),
        "queued/uuid metadata is cleared"
    );

    cache.project_display("c1", None, None, || unreachable!());
    assert_eq!(recorder.calls()[1], vec![RawChange::Structural(1)]);
}

#[test]
fn strip_all_queued_records_one_structural_entry_at_the_earliest_touched_index() {
    let mut cache = MessageCache::new();
    let queued = |id: &str| {
        let mut m = msg(id);
        let mut md = std::collections::HashMap::new();
        md.insert("queued".to_string(), serde_json::Value::Bool(true));
        m.metadata = Some(md);
        m
    };
    cache.append("c1", msg("a"));
    cache.append("c1", queued("q1"));
    cache.append("c1", queued("q2"));
    let recorder = seed(&mut cache, "c1");

    assert!(cache.strip_all_queued("c1"));
    for m in cache.get("c1").unwrap() {
        assert!(
            m.metadata
                .as_ref()
                .and_then(|md| md.get("queued"))
                .is_none(),
            "every queued flag is cleared"
        );
    }

    cache.project_display("c1", None, None, || unreachable!());
    assert_eq!(recorder.calls()[1], vec![RawChange::Structural(1)]);
}

#[test]
fn strip_all_queued_is_a_noop_when_nothing_is_queued() {
    let mut cache = MessageCache::new();
    cache.append("c1", msg("a"));
    assert!(!cache.strip_all_queued("c1"));
}
