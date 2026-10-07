//! Agent provenance on chats (migration 32): the stored `created_by_chat_id`
//! and the delegation state `CHAT_SELECT_FIELDS` derives from
//! `delegated_tasks` on every read.

use mainframe_types::orchestration::{ChatDelegation, ChatOrchestration, TaskRole, TaskStatus};

use crate::DbError;
use crate::chats::ChatsRepository;

impl ChatsRepository {
    /// Records which chat's agent created `chat_id` (and, for a delegated
    /// child, the parent it nests under).
    pub fn set_agent_lineage(
        &self,
        chat_id: &str,
        created_by_chat_id: &str,
        parent_chat_id: Option<&str>,
    ) -> Result<(), DbError> {
        self.db.execute(
            "UPDATE chats SET created_by_chat_id = ?, \
             parent_chat_id = COALESCE(?, parent_chat_id) WHERE id = ?",
            rusqlite::params![created_by_chat_id, parent_chat_id, chat_id],
        )?;
        Ok(())
    }
}

/// Reads the orchestration columns `CHAT_SELECT_FIELDS` selects.
/// `delegated_waiting` and `agent_outbox` need live state, so the chat
/// manager fills them in.
pub(crate) fn map_orchestration(row: &rusqlite::Row<'_>) -> Result<ChatOrchestration, DbError> {
    let delegation = row
        .get::<_, Option<String>>("delegation")?
        .as_deref()
        .and_then(parse_delegation);
    let active_child_ids = row
        .get::<_, Option<String>>("activeDelegatedChildIds")?
        .map(|ids| ids.split(' ').map(str::to_string).collect())
        .unwrap_or_default();
    Ok(ChatOrchestration {
        created_by_chat_id: row.get("createdByChatId")?,
        delegation,
        delegated_waiting: None,
        agent_outbox: None,
        active_child_ids,
    })
}

/// `"<task id> <role> <status>"`, packed by one subquery. Every part is an
/// identifier or an enum word, so none holds a space.
fn parse_delegation(packed: &str) -> Option<ChatDelegation> {
    let mut parts = packed.split(' ');
    let task_id = parts.next()?.to_string();
    let role = TaskRole::parse(parts.next()?)?;
    let status = TaskStatus::parse(parts.next()?)?;
    Some(ChatDelegation {
        task_id,
        role,
        status,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_delegation_reads_the_packed_triple_and_rejects_garbage() {
        assert_eq!(
            parse_delegation("task_c1 review waiting"),
            Some(ChatDelegation {
                task_id: "task_c1".into(),
                role: TaskRole::Review,
                status: TaskStatus::Waiting,
            })
        );
        assert_eq!(parse_delegation("task_c1 review"), None);
        assert_eq!(parse_delegation("task_c1 nope running"), None);
    }
}
