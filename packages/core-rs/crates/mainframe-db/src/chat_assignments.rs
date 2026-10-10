use crate::{DbError, enum_to_db_string};
use mainframe_types::chat_patch::ChatPatch;
use rusqlite::types::Value as SqlValue;

type Column = (
    &'static str,
    fn(&ChatPatch) -> Result<Option<SqlValue>, DbError>,
);
const COLUMNS: &[Column] = &[
    ("adapter_id = ?", |patch| match &patch.adapter_id {
        Some(v) => Ok(Some(SqlValue::Text(v.clone()))),
        None => Ok(None),
    }),
    ("model = ?", |patch| match &patch.model {
        Some(v) => Ok(Some(SqlValue::Text(v.clone()))),
        None => Ok(None),
    }),
    ("claude_session_id = ?", |patch| {
        match &patch.claude_session_id {
            Some(v) => Ok(Some(SqlValue::Text(v.clone()))),
            None => Ok(None),
        }
    }),
    ("session_file_path = ?", |patch| {
        match &patch.session_file_path {
            Some(v) => Ok(Some(SqlValue::Text(v.clone()))),
            None => Ok(None),
        }
    }),
    ("status = ?", |patch| match &patch.status {
        Some(v) => Ok(Some(SqlValue::Text(enum_to_db_string(v)?))),
        None => Ok(None),
    }),
    ("total_cost = ?", |patch| match patch.total_cost {
        Some(v) => Ok(Some(SqlValue::Real(v))),
        None => Ok(None),
    }),
    ("total_tokens_input = ?", |patch| {
        match patch.total_tokens_input {
            Some(v) => Ok(Some(SqlValue::Integer(v))),
            None => Ok(None),
        }
    }),
    ("total_tokens_output = ?", |patch| {
        match patch.total_tokens_output {
            Some(v) => Ok(Some(SqlValue::Integer(v))),
            None => Ok(None),
        }
    }),
    ("last_context_tokens_input = ?", |patch| {
        match patch.last_context_tokens_input {
            Some(v) => Ok(Some(SqlValue::Integer(v))),
            None => Ok(None),
        }
    }),
    ("last_context_total_tokens = ?", |patch| {
        match patch.last_context_total_tokens {
            Some(v) => Ok(Some(SqlValue::Integer(v as i64))),
            None => Ok(None),
        }
    }),
    ("last_context_max_tokens = ?", |patch| {
        match patch.last_context_max_tokens {
            Some(v) => Ok(Some(SqlValue::Integer(v as i64))),
            None => Ok(None),
        }
    }),
    ("title = ?", |patch| match &patch.title {
        Some(v) => Ok(Some(SqlValue::Text(v.clone()))),
        None => Ok(None),
    }),
    ("permission_mode = ?", |patch| {
        match &patch.permission_mode {
            Some(v) => Ok(Some(SqlValue::Text(enum_to_db_string(v)?))),
            None => Ok(None),
        }
    }),
    ("worktree_path = ?", |patch| match &patch.worktree_path {
        Some(v) => Ok(Some(opt_text(v))),
        None => Ok(None),
    }),
    ("branch_name = ?", |patch| match &patch.branch_name {
        Some(v) => Ok(Some(opt_text(v))),
        None => Ok(None),
    }),
    ("mentions = ?", |patch| match &patch.mentions {
        Some(v) => Ok(Some(SqlValue::Text(serde_json::to_string(v)?))),
        None => Ok(None),
    }),
    ("process_state = ?", |patch| match &patch.process_state {
        Some(v) => Ok(Some(match v {
            Some(ps) => SqlValue::Text(enum_to_db_string(ps)?),
            None => SqlValue::Null,
        })),
        None => Ok(None),
    }),
    ("created_at = ?", |patch| match &patch.created_at {
        Some(v) => Ok(Some(SqlValue::Text(v.clone()))),
        None => Ok(None),
    }),
    ("updated_at = ?", |patch| match &patch.updated_at {
        Some(v) => Ok(Some(SqlValue::Text(v.clone()))),
        None => Ok(None),
    }),
    ("pinned = ?", |patch| match patch.pinned {
        Some(v) => Ok(Some(SqlValue::Integer(i64::from(v)))),
        None => Ok(None),
    }),
    ("effort = ?", |patch| match &patch.effort {
        Some(v) => Ok(Some(match v {
            Some(e) => SqlValue::Text(enum_to_db_string(e)?),
            None => SqlValue::Null,
        })),
        None => Ok(None),
    }),
    ("fast = ?", |patch| match &patch.fast {
        Some(v) => Ok(Some(nullable_bool_value(v))),
        None => Ok(None),
    }),
    ("ultracode = ?", |patch| match &patch.ultracode {
        Some(v) => Ok(Some(nullable_bool_value(v))),
        None => Ok(None),
    }),
    ("adaptive_thinking = ?", |patch| {
        match &patch.adaptive_thinking {
            Some(v) => Ok(Some(nullable_bool_value(v))),
            None => Ok(None),
        }
    }),
    ("plan_mode = ?", |patch| match patch.plan_mode {
        Some(v) => Ok(Some(SqlValue::Integer(i64::from(v)))),
        None => Ok(None),
    }),
    ("transcript_missing = ?", |patch| {
        match patch.transcript_missing {
            Some(v) => Ok(Some(SqlValue::Integer(i64::from(v)))),
            None => Ok(None),
        }
    }),
    ("vendor_session_ephemeral = ?", |patch| {
        match patch.vendor_session_ephemeral {
            Some(v) => Ok(Some(SqlValue::Integer(i64::from(v)))),
            None => Ok(None),
        }
    }),
    ("context_lost_at = ?", |patch| {
        match &patch.context_lost_at {
            Some(v) => Ok(Some(SqlValue::Text(v.clone()))),
            None => Ok(None),
        }
    }),
];

pub(crate) trait ChatAssignments {
    fn into_assignments(self) -> Result<(Vec<&'static str>, Vec<SqlValue>), DbError>;
}

impl ChatAssignments for &ChatPatch {
    fn into_assignments(self) -> Result<(Vec<&'static str>, Vec<SqlValue>), DbError> {
        let mut columns = Vec::new();
        let mut values = Vec::new();
        for (column, encode) in COLUMNS {
            if let Some(value) = encode(self)? {
                columns.push(*column);
                values.push(value);
            }
        }
        Ok((columns, values))
    }
}

fn opt_text(value: &Option<String>) -> SqlValue {
    value.clone().map_or(SqlValue::Null, SqlValue::Text)
}

fn nullable_bool_value(value: &Option<bool>) -> SqlValue {
    value.map_or(SqlValue::Null, |value| SqlValue::Integer(i64::from(value)))
}
