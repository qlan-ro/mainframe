//! `ChatPatch` → the `SET` clause of a `chats` UPDATE.

use crate::{DbError, enum_to_db_string};
use mainframe_types::chat_patch::ChatPatch;
use rusqlite::types::Value as SqlValue;
use serde::Serialize;

/// The column of every field `patch` sets, with its value at the same index.
/// A `Some(None)` field writes NULL.
pub(crate) fn assignments(
    patch: &ChatPatch,
) -> Result<(Vec<&'static str>, Vec<SqlValue>), DbError> {
    let tuning = &patch.tuning;
    let mut set = Assignments::default();
    set.text("adapter_id", patch.adapter_id.as_deref());
    set.text("model", patch.model.as_deref());
    set.text("claude_session_id", patch.vendor_session_id.as_deref());
    set.text("session_file_path", patch.session_file_path.as_deref());
    set.enumeration("status", patch.status.as_ref().map(Some))?;
    set.push("total_cost", patch.total_cost.map(SqlValue::Real));
    set.integer("total_tokens_input", patch.total_tokens_input);
    set.integer("total_tokens_output", patch.total_tokens_output);
    set.integer("last_context_tokens_input", patch.last_context_tokens_input);
    set.unsigned("last_context_total_tokens", patch.last_context_total_tokens);
    set.unsigned("last_context_max_tokens", patch.last_context_max_tokens);
    set.text("title", patch.title.as_deref());
    set.enumeration("permission_mode", patch.permission_mode.as_ref().map(Some))?;
    set.nullable_text("worktree_path", patch.worktree_path.as_ref());
    set.nullable_text("branch_name", patch.branch_name.as_ref());
    let mentions = patch.mentions.as_ref().map(serde_json::to_string);
    set.push("mentions", mentions.transpose()?.map(SqlValue::Text));
    set.enumeration(
        "process_state",
        patch.process_state.as_ref().map(Option::as_ref),
    )?;
    set.text("created_at", patch.created_at.as_deref());
    set.text("updated_at", patch.updated_at.as_deref());
    set.flag("pinned", patch.pinned.map(Some));
    set.enumeration("effort", tuning.effort.as_ref().map(Option::as_ref))?;
    set.flag("fast", tuning.fast);
    set.flag("ultracode", tuning.ultracode);
    set.flag("adaptive_thinking", tuning.adaptive_thinking);
    set.flag("plan_mode", patch.plan_mode.map(Some));
    set.flag("transcript_missing", patch.transcript_missing.map(Some));
    set.flag(
        "vendor_session_ephemeral",
        patch.vendor_session_ephemeral.map(Some),
    );
    set.text("context_lost_at", patch.context_lost_at.as_deref());
    Ok((set.columns, set.values))
}

/// Collects assignments. Each typed helper skips a `None` field; for the
/// nullable ones an inner `None` writes NULL.
#[derive(Default)]
struct Assignments {
    columns: Vec<&'static str>,
    values: Vec<SqlValue>,
}

impl Assignments {
    fn push(&mut self, column: &'static str, value: Option<SqlValue>) {
        if let Some(value) = value {
            self.columns.push(column);
            self.values.push(value);
        }
    }

    fn text(&mut self, column: &'static str, value: Option<&str>) {
        self.push(column, value.map(|v| SqlValue::Text(v.to_string())));
    }

    fn nullable_text(&mut self, column: &'static str, value: Option<&Option<String>>) {
        let value = value.map(|v| v.clone().map_or(SqlValue::Null, SqlValue::Text));
        self.push(column, value);
    }

    fn integer(&mut self, column: &'static str, value: Option<i64>) {
        self.push(column, value.map(SqlValue::Integer));
    }

    /// Token counts never approach `i64::MAX`; saturate rather than wrap.
    fn unsigned(&mut self, column: &'static str, value: Option<u64>) {
        let value = value.map(|v| SqlValue::Integer(i64::try_from(v).unwrap_or(i64::MAX)));
        self.push(column, value);
    }

    fn flag(&mut self, column: &'static str, value: Option<Option<bool>>) {
        let value = value.map(|v| v.map_or(SqlValue::Null, |v| SqlValue::Integer(i64::from(v))));
        self.push(column, value);
    }

    fn enumeration<T: Serialize>(
        &mut self,
        column: &'static str,
        value: Option<Option<&T>>,
    ) -> Result<(), DbError> {
        let value = value
            .map(|v| {
                v.map_or(Ok(SqlValue::Null), |v| {
                    enum_to_db_string(v).map(SqlValue::Text)
                })
            })
            .transpose()?;
        self.push(column, value);
        Ok(())
    }
}
