#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "Test assertions and scenarios"
)]

//! `ChatsRepository::get_skill_files`: stored entries of either shape read
//! back with a display name derived from the path.

use std::rc::Rc;

use mainframe_db::schema::initialize_schema;
use mainframe_db::{ChatsRepository, ProjectsRepository};
use mainframe_types::chat::NewChat;
use mainframe_types::context::SkillFileEntry;
use rusqlite::Connection;

fn entry(path: &str, display_name: &str) -> SkillFileEntry {
    SkillFileEntry {
        path: path.to_string(),
        display_name: display_name.to_string(),
    }
}

#[test]
fn skill_files_read_back_with_names_derived_from_their_paths() {
    let conn = Connection::open_in_memory().unwrap();
    initialize_schema(&conn).unwrap();
    let conn = Rc::new(conn);
    let project = ProjectsRepository::new(Rc::clone(&conn))
        .create("/project/skills", None)
        .unwrap();
    let chats = ChatsRepository::new(Rc::clone(&conn));
    let chat = chats
        .create(&NewChat {
            project_id: project.id,
            adapter_id: "claude".to_string(),
            ..Default::default()
        })
        .unwrap();
    // Older rows store bare paths; newer ones store objects whose
    // `displayName` is ignored on read.
    conn.execute(
        "UPDATE chats SET skill_files = ?1 WHERE id = ?2",
        rusqlite::params![
            r#"["/skills/deploy/SKILL.md", {"path": "/skills/notes.md", "displayName": "stale"}, "SKILL.md", {"name": "no path"}]"#,
            chat.id
        ],
    )
    .unwrap();

    assert_eq!(
        chats.get_skill_files(&chat.id).unwrap(),
        vec![
            entry("/skills/deploy/SKILL.md", "deploy"),
            entry("/skills/notes.md", "notes.md"),
            entry("SKILL.md", "SKILL.md"),
            entry("", ""),
        ]
    );
}
