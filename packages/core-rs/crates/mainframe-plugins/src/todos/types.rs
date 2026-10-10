//! The todo row and its enums. Serde names are the wire names: the response
//! object keeps the raw snake_case column names (`project_id`, `order_index`)
//! the Kanban UI reads, and the enum strings double as the stored values.

use mainframe_db::sql_types::FromRow;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;

use crate::PluginError;

/// Tells a known enum value from one passed through as `Other`.
pub(crate) trait KnownValue {
    fn is_known(&self) -> bool;
}

macro_rules! wire_enum {
    ($name:ident { $first:ident => $first_wire:literal $(, $variant:ident => $wire:literal)* $(,)? }) => {
        /// The known values plus `Other`, which carries any other stored string
        /// unchanged: outside writers (the `todos` skill, lane scripts) write
        /// `data.db` directly, so a value this build does not know must survive
        /// a read → serialize → save round trip. Request bodies reject `Other`
        /// (see `input.rs`).
        #[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
        pub(crate) enum $name {
            #[default]
            #[serde(rename = $first_wire)]
            $first,
            $(#[serde(rename = $wire)] $variant,)*
            #[serde(untagged)]
            Other(String),
        }

        impl $name {
            pub(crate) fn as_str(&self) -> &str {
                match self {
                    Self::$first => $first_wire,
                    $(Self::$variant => $wire,)*
                    Self::Other(raw) => raw,
                }
            }
        }

        impl KnownValue for $name {
            fn is_known(&self) -> bool {
                !matches!(self, Self::Other(_))
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
    /// The column label used by the "Moved to …" notification; an unknown
    /// status is shown as stored.
    pub(crate) fn label(&self) -> &str {
        match self {
            Self::Open => "Open",
            Self::InProgress => "In Progress",
            Self::Done => "Done",
            Self::Other(raw) => raw,
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

    /// An unknown enum string is kept as `Other` and a malformed JSON column
    /// (historical double-encoded arrays, for example) reads as empty; both
    /// log the todo id, the column and the raw value.
    fn from_row(row: &rusqlite::Row<'_>) -> Result<Self, PluginError> {
        let id: String = row.get("id")?;
        Ok(Self {
            number: row.get("number")?,
            project_id: row.get("project_id")?,
            title: row.get("title")?,
            body: row.get("body")?,
            status: stored_enum(&id, "status", row.get("status")?),
            type_field: stored_enum(&id, "type", row.get("type")?),
            priority: stored_enum(&id, "priority", row.get("priority")?),
            labels: stored_json_array(&id, "labels", row.get("labels")?),
            assignees: stored_json_array(&id, "assignees", row.get("assignees")?),
            milestone: row.get("milestone")?,
            dependencies: stored_json_array(&id, "dependencies", row.get("dependencies")?),
            order_index: row.get("order_index")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            id,
        })
    }
}

/// Every string deserializes (unknown ones as `Other`), so in practice this
/// only reports values this build does not know; the default arm exists for
/// the generic bound.
fn stored_enum<T>(todo_id: &str, column: &str, raw: String) -> T
where
    T: DeserializeOwned + Default + KnownValue,
{
    match serde_json::from_value::<T>(Value::String(raw.clone())) {
        Ok(value) => {
            if !value.is_known() {
                tracing::warn!(
                    todo_id,
                    column,
                    raw,
                    "todos: unknown stored value, passing it through unchanged"
                );
            }
            value
        }
        Err(err) => {
            tracing::warn!(todo_id, column, raw, err = %err, "todos: unreadable stored value");
            T::default()
        }
    }
}

fn stored_json_array<T: DeserializeOwned>(
    todo_id: &str,
    column: &str,
    raw: Option<String>,
) -> Vec<T> {
    let Some(raw) = raw.filter(|raw| !raw.is_empty()) else {
        return Vec::new();
    };
    match serde_json::from_str(&raw) {
        Ok(values) => values,
        Err(err) => {
            tracing::warn!(
                todo_id, column, raw, err = %err,
                "todos: malformed JSON column, defaulting to []"
            );
            Vec::new()
        }
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
