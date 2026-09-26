//! Synthetic user-event suppression cases (todo #363): the CLI's own
//! coordinate note (`isSynthetic: true`, no `isMeta`) must never surface as a
//! CLI-feedback System marker, at top level or inside a subagent. Nested as a
//! child of `events.rs`'s `mod tests` via `#[path]` (see the `mod
//! synthetic_tests` declaration there) so it shares `RecordingSink`,
//! `session()` and `feed()` through `super::*` without any visibility changes.

use super::*;

const COORDINATE_NOTE: &str = "[Image: original 1206x2622, displayed at 920x2000. Multiply coordinates by 1.31 to map to original image.]";

#[test]
fn top_level_synthetic_string_event_produces_no_cli_message() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({
            "type": "user",
            "isSynthetic": true,
            "message": { "role": "user", "content": COORDINATE_NOTE }
        }),
    );
    assert!(sink.r().cli_messages.is_empty());
}

#[test]
fn subagent_synthetic_string_event_produces_no_subagent_child_text() {
    let s = session();
    let sink = RecordingSink::default();
    feed(
        &s,
        &sink,
        serde_json::json!({
            "type": "user",
            "isSynthetic": true,
            "parent_tool_use_id": "toolu_parent_agent",
            "message": { "role": "user", "content": COORDINATE_NOTE }
        }),
    );
    assert!(sink.r().subagent.is_empty());
    assert!(sink.r().cli_messages.is_empty());
}
