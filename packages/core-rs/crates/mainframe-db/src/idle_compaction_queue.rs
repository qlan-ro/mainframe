use crate::DbError;
use mainframe_types::chat::ChatMessage;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueuedInput {
    pub uuid: String,
    pub content: String,
    pub prepared_text: String,
    pub text_prefix: String,
    pub images: Vec<QueuedImage>,
    pub attachment_ids: Option<Vec<String>>,
    pub command: Option<QueuedCommand>,
    pub message: ChatMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueuedImage {
    pub media_type: String,
    pub data: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueuedCommand {
    pub name: String,
    pub source: String,
    pub args: Option<String>,
}

pub fn put(db: &Connection, chat_id: &str, input: &QueuedInput) -> Result<(), DbError> {
    let json = serde_json::to_string(input)?;
    db.execute(
        "INSERT INTO idle_compaction_queue(uuid,chat_id,payload) VALUES (?1,?2,?3)
        ON CONFLICT(uuid) DO UPDATE SET payload=excluded.payload WHERE chat_id=excluded.chat_id",
        params![input.uuid, chat_id, json],
    )?;
    Ok(())
}

pub fn list(db: &Connection, chat_id: &str) -> Result<Vec<QueuedInput>, DbError> {
    let mut stmt =
        db.prepare("SELECT payload FROM idle_compaction_queue WHERE chat_id=?1 ORDER BY rowid")?;
    let rows = stmt.query_map([chat_id], |r| r.get::<_, String>(0))?;
    rows.map(|r| Ok(serde_json::from_str(&r?)?)).collect()
}

pub fn remove(db: &Connection, chat_id: &str, uuid: &str) -> Result<bool, DbError> {
    Ok(db.execute(
        "DELETE FROM idle_compaction_queue WHERE chat_id=?1 AND uuid=?2",
        params![chat_id, uuid],
    )? == 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DatabaseManager;
    use mainframe_types::chat::ChatMessageType;
    fn input(uuid: &str) -> QueuedInput {
        QueuedInput {
            uuid: uuid.into(),
            content: "text".into(),
            prepared_text: "attachment\n\ntext".into(),
            text_prefix: "attachment".into(),
            images: vec![QueuedImage {
                media_type: "image/png".into(),
                data: "aW1hZ2U=".into(),
                path: Some("/tmp/image.png".into()),
            }],
            attachment_ids: Some(vec!["attachment-id".into()]),
            command: Some(QueuedCommand {
                name: "explain".into(),
                source: "mainframe".into(),
                args: Some("args".into()),
            }),
            message: ChatMessage {
                id: uuid.into(),
                chat_id: "c".into(),
                r#type: ChatMessageType::User,
                content: Vec::new(),
                timestamp: "timestamp".into(),
                metadata: None,
            },
        }
    }
    #[test]
    fn durable_fifo_keeps_payload_and_updates_without_reordering() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db");
        let db = DatabaseManager::open(&path).unwrap();
        db.connection().execute("INSERT INTO projects(id,name,path,created_at,last_opened_at) VALUES ('p','p','/p','','')",[]).unwrap();
        db.connection().execute("INSERT INTO chats(id,project_id,adapter_id,status,created_at,updated_at) VALUES ('c','p','claude','active','','')",[]).unwrap();
        put(db.connection(), "c", &input("one")).unwrap();
        put(db.connection(), "c", &input("two")).unwrap();
        drop(db);
        let db = DatabaseManager::open(&path).unwrap();
        let mut first = list(db.connection(), "c").unwrap().remove(0);
        first.content = "edited".into();
        put(db.connection(), "c", &first).unwrap();
        let items = list(db.connection(), "c").unwrap();
        assert_eq!(
            items.iter().map(|i| i.uuid.as_str()).collect::<Vec<_>>(),
            vec!["one", "two"]
        );
        assert_eq!(items[0].images[0].data, "aW1hZ2U=");
        assert_eq!(items[0].attachment_ids, Some(vec!["attachment-id".into()]));
        assert_eq!(
            items[0].command.as_ref().unwrap().args.as_deref(),
            Some("args")
        );
        assert!(remove(db.connection(), "c", "one").unwrap());
        assert!(!remove(db.connection(), "c", "one").unwrap());
        assert_eq!(list(db.connection(), "c").unwrap()[0].uuid, "two");
    }
}
