#![allow(clippy::unwrap_used, clippy::expect_used)]

//! Byte-level pin of a sparse `chats` row as read back and serialized. The
//! expected string was captured from the pre-refactor row mapper.

use std::rc::Rc;

use mainframe_db::ChatsRepository;
use mainframe_db::schema::initialize_schema;
use rusqlite::Connection;

#[test]
fn row_with_every_nullable_column_null_serializes_like_before() {
    let conn = Connection::open_in_memory().unwrap();
    initialize_schema(&conn).unwrap();
    conn.execute(
        "INSERT INTO projects (id, name, path, created_at, last_opened_at) \
         VALUES ('proj_golden', 'golden', '/tmp/golden', '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.000Z')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO chats (id, adapter_id, project_id, status, created_at, updated_at) \
         VALUES ('chat_golden', 'claude', 'proj_golden', 'active', '2026-10-01T10:00:00.000Z', '2026-10-01T11:00:00.000Z')",
        [],
    )
    .unwrap();
    let nullable: Vec<String> = conn
        .prepare("SELECT name FROM pragma_table_info('chats') WHERE \"notnull\" = 0 AND pk = 0")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    // The four counters are schema-nullable but carry `DEFAULT 0` and are read
    // as required numbers, so a NULL there is a corrupt row, not a sparse one.
    const COUNTERS: [&str; 4] = [
        "total_cost",
        "total_tokens_input",
        "total_tokens_output",
        "last_context_tokens_input",
    ];
    for column in nullable.iter().filter(|c| !COUNTERS.contains(&c.as_str())) {
        conn.execute(&format!("UPDATE chats SET \"{column}\" = NULL"), [])
            .unwrap();
    }
    let chats = ChatsRepository::new(Rc::new(conn), None);
    let chat = chats.get("chat_golden").unwrap().unwrap();
    assert_eq!(serde_json::to_string(&chat).unwrap(), EXPECTED);
}

const EXPECTED: &str = r#"{"id":"chat_golden","adapterId":"claude","projectId":"proj_golden","planMode":false,"status":"active","createdAt":"2026-10-01T10:00:00.000Z","updatedAt":"2026-10-01T11:00:00.000Z","totalCost":0.0,"totalTokensInput":0,"totalTokensOutput":0,"lastContextTokensInput":0,"mentions":[],"modifiedFiles":[],"processState":null,"transcriptMissing":false,"pinned":false,"fast":null,"ultracode":null,"adaptiveThinking":null,"detectedPrs":[],"temporary":false,"noProject":false,"parentChatId":null}"#;
