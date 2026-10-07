//! The push for a delegated child's permission prompt. The user answers it
//! from the `delegate_task` card in the parent's transcript, and a task chat
//! has no sidebar row of its own, so the push names both chats and opens the
//! top-level chat that lists the task (spec: "Permission prompts in
//! children").

use mainframe_types::chat::Chat;

use crate::db::Db;

/// The sidebar's own fallback, so a push and the row read the same.
const UNTITLED: &str = "Untitled session";

/// Task depth is capped well below this; the bound only guards a corrupt
/// lineage cycle.
const MAX_ANCESTORS: usize = 16;

/// What a delegated child's permission push says and where it leads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DelegatedPush {
    /// `"<child>" (task of "<parent>") needs permission`.
    pub body: String,
    /// The nearest ancestor that is not itself a task chat: the chat the
    /// push opens, whose card holds the gate.
    pub open_chat_id: String,
}

/// `Some` when `chat_id` is a delegated child; `None` for any other chat,
/// which keeps its usual body and opens itself.
pub(crate) fn delegated_permission_push(db: &Db, chat_id: &str) -> Option<DelegatedPush> {
    let id = chat_id.to_string();
    let read = db.call_blocking(move |d| {
        let Some(child) = d.chats.get(&id)? else {
            return Ok(None);
        };
        let Some(parent_id) = task_parent(&child) else {
            return Ok(None);
        };
        let parent = d.chats.get(&parent_id)?;
        let parent_title = parent.as_ref().and_then(|p| p.title.clone());
        let mut open_chat_id = parent_id;
        let mut cursor = parent;
        for _ in 0..MAX_ANCESTORS {
            let Some(next) = cursor.as_ref().and_then(task_parent) else {
                break;
            };
            cursor = d.chats.get(&next)?;
            open_chat_id = next;
        }
        Ok(Some(DelegatedPush {
            body: body(child.title.as_deref(), parent_title.as_deref()),
            open_chat_id,
        }))
    });
    match read {
        Ok(push) => push,
        Err(err) => {
            tracing::warn!(chat_id, %err, "failed to read a delegated chat for its push");
            None
        }
    }
}

/// The parent a task chat nests under; `None` for a chat no agent delegated.
fn task_parent(chat: &Chat) -> Option<String> {
    chat.orchestration.delegation.as_ref()?;
    chat.parent_chat_id.clone().flatten()
}

fn body(child: Option<&str>, parent: Option<&str>) -> String {
    let name = |title: Option<&str>| {
        title
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .unwrap_or(UNTITLED)
            .to_string()
    };
    format!(
        "\"{}\" (task of \"{}\") needs permission",
        name(child),
        name(parent)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn body_names_both_chats_and_falls_back_for_blank_titles() {
        assert_eq!(
            body(Some("Review the diff"), Some("Ship v2")),
            "\"Review the diff\" (task of \"Ship v2\") needs permission"
        );
        assert_eq!(
            body(None, Some("  ")),
            "\"Untitled session\" (task of \"Untitled session\") needs permission"
        );
    }
}
