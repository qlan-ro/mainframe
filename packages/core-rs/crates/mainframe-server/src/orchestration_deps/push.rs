//! Push text for a delegated child's permission prompt. The user answers it
//! in the child, but thinks of the work as the parent's, so the body names
//! both (spec: "Permission prompts in children").

use crate::db::Db;

/// The sidebar's own fallback, so a push and the row read the same.
const UNTITLED: &str = "Untitled session";

/// `"<child>" (task of "<parent>") needs permission` when `chat_id` is a
/// delegated child; `None` for any other chat, which keeps its usual body.
pub(crate) fn delegated_permission_body(db: &Db, chat_id: &str) -> Option<String> {
    let id = chat_id.to_string();
    let titles = db.call_blocking(move |d| {
        let Some(child) = d.chats.get(&id)? else {
            return Ok(None);
        };
        let parent_id = child.parent_chat_id.clone().flatten();
        let (Some(_), Some(parent_id)) = (child.orchestration.delegation, parent_id) else {
            return Ok(None);
        };
        let parent_title = d.chats.get(&parent_id)?.and_then(|p| p.title);
        Ok(Some((child.title, parent_title)))
    });
    match titles {
        Ok(titles) => titles.map(|(child, parent)| body(child.as_deref(), parent.as_deref())),
        Err(err) => {
            tracing::warn!(chat_id, %err, "failed to read a delegated chat for its push");
            None
        }
    }
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
