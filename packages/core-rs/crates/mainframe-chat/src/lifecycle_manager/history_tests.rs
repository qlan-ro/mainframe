use super::restore_history;
use crate::message_cache::MessageCache;
use mainframe_display::incremental::IncrementalProjector;
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};
use mainframe_types::content::LeafContent;

fn message(id: &str, role: ChatMessageType) -> ChatMessage {
    ChatMessage {
        id: id.into(),
        chat_id: "c".into(),
        r#type: role,
        content: vec![MessageContent::Leaf(LeafContent::Text {
            text: id.into(),
            parent_tool_use_id: None,
        })],
        timestamp: "2026-10-20T00:00:00Z".into(),
        metadata: None,
    }
}

fn next_delta(reload: bool) -> mainframe_display::DisplayDelta {
    let mut cache = MessageCache::new();
    cache.set("c", vec![message("first", ChatMessageType::User)]);
    cache.project_display("c", None, None, || Box::new(IncrementalProjector::new()));
    cache.append("c", message("second", ChatMessageType::User));
    let raw = cache.get("c").unwrap().clone();
    let overlay = message("live", ChatMessageType::Assistant);
    cache.display_snapshot("c", &raw, Some(&overlay), None, || unreachable!());
    if reload {
        let (restored, changed) = restore_history(&mut cache, "c", raw.clone());
        assert_eq!(restored, raw);
        assert!(!changed);
    }
    cache.project_display("c", Some(&overlay), None, || {
        panic!("identical reload discarded projection")
    })
}

#[test]
fn identical_reload_preserves_pending_delta_and_streaming_overlay() {
    let expected = next_delta(false);
    let actual = next_delta(true);
    assert_eq!(actual.full, expected.full);
    assert_eq!(actual.len, expected.len);
    assert_eq!(actual.changes, expected.changes);
    assert_eq!(
        actual.snapshot.materialize(),
        expected.snapshot.materialize()
    );
    assert_eq!(actual.stats.full_rebuilds, 0);
}

#[test]
fn changed_or_missing_history_still_replaces_the_projection() {
    let mut cache = MessageCache::new();
    for id in ["first", "replacement"] {
        let incoming = vec![message(id, ChatMessageType::User)];
        let (restored, changed) = restore_history(&mut cache, "c", incoming.clone());
        assert!(changed);
        assert_eq!(restored, incoming);
        let delta =
            cache.project_display("c", None, None, || Box::new(IncrementalProjector::new()));
        assert!(delta.full);
    }
}
