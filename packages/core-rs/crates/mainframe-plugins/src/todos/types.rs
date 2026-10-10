use mainframe_db::sql_types::{FromRow, JsonCol, SqlEnum};
use serde::{Deserialize, Serialize};
use crate::PluginError;

macro_rules! wire_enum {
    ($name:ident { $first:ident => $first_wire:literal, $($variant:ident => $wire:literal),* $(,)? }) => {
        #[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
        pub(crate) enum $name {
            #[default]
            #[serde(rename = $first_wire)]
            $first,
            $(#[serde(rename = $wire)] $variant),*
        }
        impl $name {
            pub(crate) fn as_str(self) -> &'static str {
                match self { Self::$first => $first_wire, $(Self::$variant => $wire),* }
            }
        }
        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str(self.as_str()) }
        }
    };
}

wire_enum!(TodoStatus { Open => "open", InProgress => "in_progress", Done => "done" });
wire_enum!(TodoType { Feature => "feature", Bug => "bug", Enhancement => "enhancement", Documentation => "documentation", Question => "question", WontFix => "wont_fix", Duplicate => "duplicate", Invalid => "invalid" });
wire_enum!(TodoPriority { Medium => "medium", Low => "low", High => "high", Critical => "critical" });

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
