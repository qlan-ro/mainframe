use crate::DbError;
use mainframe_types::compaction::{CompactionMetadata, NativeCompactionRequest};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RealRun {
    pub generation: String,
    pub completed_ms: Option<i64>,
    pub claim: Option<String>,
}

pub fn begin(db: &Connection, chat_id: &str, generation: &str) -> Result<(), DbError> {
    db.execute(
        "INSERT INTO idle_compaction_runs(chat_id,generation)
        VALUES (?1,?2) ON CONFLICT(chat_id) DO UPDATE SET
        generation=excluded.generation, outcome='running', completed_ms=NULL, claim=NULL,
        command_uuid=NULL, session_generation=NULL WHERE idle_compaction_runs.generation != excluded.generation",
        params![chat_id, generation],
    )?;
    Ok(())
}

pub fn complete(
    db: &Connection,
    chat_id: &str,
    generation: &str,
    at: Option<i64>,
) -> Result<(), DbError> {
    db.execute(
        "UPDATE idle_compaction_runs SET completed_ms=?3, outcome=CASE WHEN ?3 IS NULL THEN 'failed' ELSE 'success' END
        WHERE chat_id=?1 AND generation=?2 AND claim IS NULL AND outcome='running'",
        params![chat_id, generation, at],
    )?;
    Ok(())
}

pub fn get(db: &Connection, chat_id: &str) -> Result<Option<RealRun>, DbError> {
    Ok(db
        .query_row(
            "SELECT generation,CASE WHEN outcome='success' THEN completed_ms ELSE NULL END,claim FROM idle_compaction_runs
        WHERE chat_id=?1",
            [chat_id],
            |r| {
                Ok(RealRun {
                    generation: r.get(0)?,
                    completed_ms: r.get(1)?,
                    claim: r.get(2)?,
                })
            },
        )
        .optional()?)
}

pub fn claim(
    db: &Connection,
    chat_id: &str,
    generation: &str,
    request: &NativeCompactionRequest,
) -> Result<bool, DbError> {
    let tx = db.unchecked_transaction()?;
    let changed = tx.execute(
        "UPDATE idle_compaction_runs SET claim=?3,command_uuid=?4,session_generation=?5
        WHERE chat_id=?1 AND generation=?2 AND completed_ms IS NOT NULL AND outcome='success' AND claim IS NULL",
        params![
            chat_id,
            generation,
            request.id,
            request.command_uuid,
            request.session_generation
        ],
    )? == 1;
    if changed {
        tx.execute(
            "INSERT INTO idle_compaction_commands(request_id,chat_id,payload) VALUES (?1,?2,?3)",
            params![request.id, chat_id, serde_json::to_string(request)?],
        )?;
    }
    tx.commit()?;
    Ok(changed)
}

pub fn record(
    db: &Connection,
    chat_id: &str,
    metadata: &CompactionMetadata,
) -> Result<bool, DbError> {
    let json = serde_json::to_string(metadata)?;
    Ok(db.execute(
        "INSERT OR IGNORE INTO idle_compaction_provenance(chat_id,request_id,metadata,created_at)
        SELECT ?1,?2,?3,?6 WHERE EXISTS(SELECT 1 FROM idle_compaction_runs
        WHERE chat_id=?1 AND claim=?2 AND session_generation=?4 AND (command_uuid=?5 OR (?5 IS NULL AND EXISTS(SELECT 1 FROM chats WHERE id=?1 AND adapter_id='codex'))))
        ON CONFLICT(request_id) DO UPDATE SET metadata=excluded.metadata
        WHERE json_extract(idle_compaction_provenance.metadata,'$.vendorId') IS NULL
          AND json_extract(excluded.metadata,'$.vendorId') IS NOT NULL",
        params![
            chat_id,
            metadata.request_id,
            json,
            metadata.session_generation,
            metadata.command_uuid,
            mainframe_types::time::now_iso8601()
        ],
    )? == 1)
}

pub fn provenance(db: &Connection, chat_id: &str) -> Result<Vec<CompactionMetadata>, DbError> {
    let mut stmt = db.prepare(
        "SELECT metadata FROM idle_compaction_provenance WHERE chat_id=?1 ORDER BY rowid",
    )?;
    let rows = stmt.query_map([chat_id], |r| r.get::<_, String>(0))?;
    rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
}

#[cfg(test)]
mod tests;

pub fn commands(db: &Connection, chat_id: &str) -> Result<Vec<NativeCompactionRequest>, DbError> {
    let mut stmt =
        db.prepare("SELECT payload FROM idle_compaction_commands WHERE chat_id=?1 ORDER BY rowid")?;
    let rows = stmt.query_map([chat_id], |r| r.get::<_, String>(0))?;
    rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
}

pub fn markers(
    db: &Connection,
    chat_id: &str,
) -> Result<Vec<mainframe_types::chat::ChatMessage>, DbError> {
    use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent, MessageContentNode};
    let mut stmt = db.prepare("SELECT metadata,created_at FROM idle_compaction_provenance WHERE chat_id=?1 ORDER BY rowid")?;
    let rows = stmt.query_map([chat_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    rows.map(|r| {
        let (json, timestamp) = r?;
        let metadata: CompactionMetadata = serde_json::from_str(&json)?;
        Ok(ChatMessage {
            id: metadata.request_id.clone(),
            chat_id: chat_id.to_owned(),
            r#type: ChatMessageType::System,
            timestamp,
            metadata: None,
            content: vec![MessageContent::Node(MessageContentNode::Compaction {
                compaction: Some(metadata),
                parent_tool_use_id: None,
            })],
        })
    })
    .collect()
}
