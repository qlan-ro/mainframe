#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "Test assertions and scenarios"
)]

//! `ChatsRepository::update` writes every `ChatPatch` field to its column,
//! and an explicit null clears the nullable ones.

use std::rc::Rc;

use mainframe_db::schema::initialize_schema;
use mainframe_db::{ChatsRepository, ProjectsRepository};
use mainframe_types::chat::NewChat;
use mainframe_types::chat_patch::ChatPatch;
use rusqlite::Connection;
use serde_json::{Value, json};

fn setup() -> (ChatsRepository, String) {
    let conn = Connection::open_in_memory().unwrap();
    initialize_schema(&conn).unwrap();
    let conn = Rc::new(conn);
    let project = ProjectsRepository::new(Rc::clone(&conn))
        .create("/project/patch", None)
        .unwrap();
    let chats = ChatsRepository::new(conn);
    let new_chat = NewChat {
        project_id: project.id,
        adapter_id: "claude".to_string(),
        ..Default::default()
    };
    let id = chats.create(&new_chat).unwrap().id;
    (chats, id)
}

fn update(chats: &ChatsRepository, id: &str, patch: &Value) {
    let patch: ChatPatch = serde_json::from_value(patch.clone()).unwrap();
    chats.update(id, &patch).unwrap();
}

#[test]
fn every_patch_field_round_trips_through_its_column() {
    let (chats, id) = setup();
    // Every `ChatPatch` key except the daemon-internal
    // `vendorSessionEphemeral`, which the wire `Chat` never carries.
    let patch = json!({
        "adapterId": "codex", "model": "gpt", "claudeSessionId": "sess-1",
        "sessionFilePath": "/s.jsonl", "status": "archived", "totalCost": 1.5,
        "totalTokensInput": 10, "totalTokensOutput": 20,
        "lastContextTokensInput": 30, "lastContextTotalTokens": 40,
        "lastContextMaxTokens": 50, "title": "Title",
        "permissionMode": "acceptEdits", "worktreePath": "/wt", "branchName": "b",
        "mentions": [{
            "id": "m1", "kind": "file", "source": "user", "name": "a.rs",
            "path": "/a.rs", "timestamp": "2026-11-01T00:00:00.000Z"
        }],
        "processState": "working",
        "createdAt": "2026-11-01T00:00:00.000Z", "updatedAt": "2026-11-02T00:00:00.000Z",
        "pinned": true, "planMode": true, "transcriptMissing": true,
        "contextLostAt": "2026-11-03T00:00:00.000Z",
        "effort": "high", "fast": true, "ultracode": false, "adaptiveThinking": true
    });
    update(&chats, &id, &patch);
    update(&chats, &id, &json!({ "vendorSessionEphemeral": true }));

    let stored = chats.get(&id).unwrap().unwrap();
    assert!(stored.vendor_session_ephemeral);
    let wire = serde_json::to_value(stored).unwrap();
    for (key, expected) in patch.as_object().unwrap() {
        assert_eq!(wire.get(key), Some(expected), "{key}");
    }
}

#[test]
fn explicit_nulls_clear_the_nullable_columns() {
    let (chats, id) = setup();
    update(
        &chats,
        &id,
        &json!({
            "worktreePath": "/wt", "branchName": "b", "processState": "working",
            "effort": "high", "fast": true, "ultracode": true, "adaptiveThinking": true
        }),
    );
    update(
        &chats,
        &id,
        &json!({
            "worktreePath": null, "branchName": null, "processState": null,
            "effort": null, "fast": null, "ultracode": null, "adaptiveThinking": null
        }),
    );

    let chat = chats.get(&id).unwrap().unwrap();
    assert_eq!(chat.worktree_path, None);
    assert_eq!(chat.branch_name, None);
    assert_eq!(chat.process_state, Some(None));
    assert_eq!(chat.tuning.effort, None);
    assert_eq!(chat.tuning.fast, Some(None));
    assert_eq!(chat.tuning.ultracode, Some(None));
    assert_eq!(chat.tuning.adaptive_thinking, Some(None));
}
