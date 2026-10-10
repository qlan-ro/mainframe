//! The todo row and its enums. Serde names are the wire names: the response
//! object keeps the raw snake_case column names (`project_id`, `order_index`)
//! the Kanban UI reads, and the enum strings double as the stored values.

use mainframe_db::sql_types::{FromRow, JsonCol, SqlEnum};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::PluginError;

macro_rules! wire_enum {
    ($name:ident { $first:ident => $first_wire:literal $(, $variant:ident => $wire:literal)* $(,)? }) => {
        #[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
        pub(crate) enum $name {
            #[default]
            #[serde(rename = $first_wire)]
            $first,
            $(#[serde(rename = $wire)] $variant),*
        }

        impl $name {
            pub(crate) fn as_str(self) -> &'static str {
                match self {
                    Self::$first => $first_wire,
                    $(Self::$variant => $wire),*
                }
            }
        }
    };
}

wire_enum!(TodoStatus { Open => "open", InProgress => "in_progress", Done => "done" });
wire_enum!(TodoType {
    Feature => "feature",
    Bug => "bug",
    Enhancement => "enhancement",
    Documentation => "documentation",
    Question => "question",
    WontFix => "wont_fix",
    Duplicate => "duplicate",
    Invalid => "invalid",
});
wire_enum!(TodoPriority { Medium => "medium", Low => "low", High => "high", Critical => "critical" });

impl TodoStatus {
    /// The column label used by the "Moved to …" notification.
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Open => "Open",
            Self::InProgress => "In Progress",
            Self::Done => "Done",
        }
    }
}

/// One `todos` row. Field order matches the table so a fresh database and
/// the wire object list columns identically.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Todo {
    pub id: String,
    pub number: i64,
    pub project_id: String,
    pub title: String,
    pub body: String,
    pub status: TodoStatus,
    #[serde(rename = "type")]
    pub type_field: TodoType,
    pub priority: TodoPriority,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
    pub milestone: Option<String>,
    pub dependencies: Vec<i64>,
    pub order_index: f64,
    pub created_at: String,
    pub updated_at: String,
}

impl FromRow for Todo {
    type Error = PluginError;

    /// A malformed enum or JSON column (historical double-encoded arrays, for
    /// example) is logged and read as its default rather than failing the row.
    fn from_row(row: &rusqlite::Row<'_>) -> Result<Self, PluginError> {
        Ok(Self {
            id: row.get("id")?,
            number: row.get("number")?,
            project_id: row.get("project_id")?,
            title: row.get("title")?,
            body: row.get("body")?,
            status: SqlEnum::or_default(row.get("status")?, TodoStatus::default()),
            type_field: SqlEnum::or_default(row.get("type")?, TodoType::default()),
            priority: SqlEnum::or_default(row.get("priority")?, TodoPriority::default()),
            labels: JsonCol::or_default(row.get("labels")?, Vec::new()),
            assignees: JsonCol::or_default(row.get("assignees")?, Vec::new()),
            milestone: row.get("milestone")?,
            dependencies: JsonCol::or_default(row.get("dependencies")?, Vec::new()),
            order_index: row.get("order_index")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Parse a JSON array column defensively for the GitHub sync's raw-row
/// readers — historical double-encoded values (e.g. `[\"a\"]`) must not fail a
/// sync; a single bad row falls back to `[]`.
pub(crate) fn safe_json_array(raw: &str, column: &str, todo_id: &str) -> Vec<Value> {
    let source = if raw.is_empty() { "[]" } else { raw };
    match serde_json::from_str::<Value>(source) {
        Ok(Value::Array(items)) => items,
        Ok(_) => Vec::new(),
        Err(err) => {
            tracing::warn!(
                todo_id, column, raw, err = %err,
                "todos: malformed JSON column, defaulting to []"
            );
            Vec::new()
        }
    }
}
