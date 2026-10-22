use crate::encoder::ItemRole;
use crate::{EncodedDelta, EncodedItem, SessionStream, ThrottledFrame};

fn item(id: &str, text: &str) -> EncodedItem {
    EncodedItem::Message {
        id: id.into(),
        role: ItemRole::Agent,
        content: vec![mainframe_types::acp::content::ContentBlock::Text {
            text: text.into(),
            meta: None,
        }],
        meta: None,
    }
}

fn stream() -> SessionStream {
    let mut stream = SessionStream::new(0);
    let containers = vec![vec![], vec![], vec![item("held", "text")]];
    stream.seed_containers(&containers);
    stream.seed_window("chat", &containers);
    stream
}

#[test]
fn suppresses_older_revisions_and_sends_deltas_for_a_prepended_page() {
    let mut stream = stream();
    let old = EncodedDelta {
        full: false,
        len: 3,
        changes: vec![(0, vec![item("old", "changed")])],
    };
    assert!(stream.on_revision_delta(&old, Vec::new, 0, None).is_empty());
    stream.prepend_history(1, &[vec![item("page", "old")]], 3, Default::default());
    let page = EncodedDelta {
        full: false,
        len: 3,
        changes: vec![(1, vec![item("page", "older")])],
    };
    let frames = stream.on_revision_delta(&page, Vec::new, 0, None);
    assert!(
        matches!(&frames[0],ThrottledFrame::Update(mainframe_types::acp::update::SessionUpdate::AgentMessageChunk(chunk)) if chunk.message_id == "page")
    );
    let full = EncodedDelta::full(vec![
        vec![item("hidden", "secret")],
        vec![item("page", "older")],
        vec![item("held", "text")],
    ]);
    assert!(
        stream
            .on_revision_delta(&full, Vec::new, 0, None)
            .is_empty()
    );
}

#[test]
fn renumbering_floor_resyncs_once_and_stops_further_content() {
    let mut stream = stream();
    let shifted = EncodedDelta {
        full: false,
        len: 4,
        changes: vec![
            (2, vec![item("shifted", "new")]),
            (3, vec![item("held", "text")]),
        ],
    };
    let frames = stream.on_revision_delta(&shifted, Vec::new, 0, None);
    assert!(
        matches!(&frames[0], ThrottledFrame::Raw(raw) if raw.contains("_mainframe.dev/resync"))
    );
    assert!(
        stream
            .on_revision_delta(&shifted, Vec::new, 0, None)
            .is_empty()
    );
    assert_eq!(stream.history_floor(), None);
}

#[test]
fn prompt_attach_creates_only_the_newest_window() {
    let mut stream = SessionStream::new(0);
    stream.enable_window("chat");
    let containers: Vec<_> = (0..120)
        .map(|i| vec![item(&format!("m{i}"), "text")])
        .collect();
    let delta = EncodedDelta {
        full: false,
        len: 120,
        changes: vec![],
    };
    let frames = stream.on_revision_delta(&delta, || containers, 0, None);
    assert_eq!(frames.len(), 40);
    assert_eq!(stream.history_floor(), Some("m80"));
}

#[test]
fn page_seeding_does_not_swallow_a_buffered_tail_removal() {
    let mut stream = stream();
    let added = EncodedDelta {
        full: false,
        len: 4,
        changes: vec![(3, vec![item("overlay", "temporary")])],
    };
    stream.on_revision_delta(&added, Vec::new, 0, None);
    stream.prepend_history(1, &[vec![item("page", "old")]], 3, Default::default());
    let removal = EncodedDelta {
        full: false,
        len: 3,
        changes: vec![],
    };
    let frames = stream.on_revision_delta(&removal, Vec::new, 0, None);
    assert!(
        matches!(&frames[0], ThrottledFrame::Update(mainframe_types::acp::update::SessionUpdate::AgentMessage(update)) if update.message_id == "overlay")
    );
}

fn nested_stream() -> SessionStream {
    let mut held = item("held", "held");
    let EncodedItem::Message { meta, .. } = &mut held else {
        unreachable!()
    };
    *meta = Some(serde_json::json!({"_mainframe.dev":{"parentToolCallId":"parent"}}));
    let containers = vec![vec![item("parent", "parent"), held, item("tail", "tail")]];
    let mut stream = SessionStream::new(0);
    stream.seed_containers(&containers);
    stream.seed_window("chat", &containers);
    stream.set_history_floor("held");
    stream
}

#[test]
fn partial_container_deltas_retain_parents_without_reintroducing_hidden_items() {
    let mut stream = nested_stream();
    let all = vec![vec![
        item("parent", "parent"),
        item("hidden", "hidden"),
        {
            let mut held = item("held", "held");
            if let EncodedItem::Message { meta, .. } = &mut held {
                *meta = Some(serde_json::json!({"_mainframe.dev":{"parentToolCallId":"parent"}}));
            }
            held
        },
        item("tail", "tail more"),
    ]];
    let frames = stream.on_revision_delta(&EncodedDelta::full(all), Vec::new, 0, None);
    assert_eq!(frames.len(), 1);
    assert!(
        matches!(&frames[0], ThrottledFrame::Update(mainframe_types::acp::update::SessionUpdate::AgentMessageChunk(chunk)) if chunk.message_id == "tail")
    );
    assert_eq!(stream.history_floor(), Some("held"));
    let removed = EncodedDelta::full(vec![vec![
        item("parent", "parent"),
        item("tail", "tail more"),
    ]]);
    let frames = stream.on_revision_delta(&removed, Vec::new, 0, None);
    assert!(matches!(&frames[0],ThrottledFrame::Raw(raw) if raw.contains("_mainframe.dev/resync")));
    assert!(
        stream
            .on_revision_delta(&removed, Vec::new, 0, None)
            .is_empty()
    );
}

#[test]
fn partial_prepend_retains_the_suffix_index_for_later_removals() {
    let mut stream = nested_stream();
    stream.prepend_history(
        0,
        &[vec![item("parent", "parent"), item("page", "earlier")]],
        1,
        Default::default(),
    );
    stream.set_history_floor("page");
    let changed = EncodedDelta::full(vec![vec![
        item("parent", "parent"),
        item("page", "earlier"),
        item("held", "held"),
    ]]);
    let frames = stream.on_revision_delta(&changed, Vec::new, 0, None);
    assert!(frames.iter().any(|frame|matches!(frame,ThrottledFrame::Update(mainframe_types::acp::update::SessionUpdate::AgentMessage(upsert)) if upsert.message_id == "tail" && upsert.content == Some(Some(Vec::new())))));
}

#[test]
fn a_page_does_not_swallow_a_buffered_update_to_shared_parent_context() {
    let mut stream = nested_stream();
    let mut page = item("page", "earlier");
    if let EncodedItem::Message { meta, .. } = &mut page {
        *meta = Some(serde_json::json!({"_mainframe.dev":{"parentToolCallId":"parent"}}));
    }
    stream.prepend_history(
        0,
        &[vec![item("parent", "parent new"), page.clone()]],
        1,
        Default::default(),
    );
    stream.set_history_floor("page");
    let containers = vec![vec![
        item("parent", "parent new"),
        page,
        item("held", "held"),
        item("tail", "tail"),
    ]];
    let frames = stream.on_revision_delta(&EncodedDelta::full(containers), Vec::new, 0, None);
    assert!(frames.iter().any(|frame|matches!(frame,ThrottledFrame::Update(mainframe_types::acp::update::SessionUpdate::AgentMessageChunk(chunk)) if chunk.message_id == "parent")));
}

#[test]
fn adding_an_unknown_context_ancestor_resyncs_instead_of_appending_it_after_children() {
    let mut stream = nested_stream();
    let mut reparented = item("held", "held");
    if let EncodedItem::Message { meta, .. } = &mut reparented {
        *meta = Some(serde_json::json!({"_mainframe.dev":{"parentToolCallId":"new-parent"}}));
    }
    let changed = EncodedDelta::full(vec![vec![
        item("parent", "parent"),
        item("new-parent", "new parent"),
        reparented,
        item("tail", "tail"),
    ]]);
    let frames = stream.on_revision_delta(&changed, Vec::new, 0, None);
    assert!(matches!(&frames[0],ThrottledFrame::Raw(raw) if raw.contains("_mainframe.dev/resync")));
}
