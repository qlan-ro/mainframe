//! Request bodies. The historical hand-rolled validation accepted `null` as
//! "absent" everywhere and a non-string `body`/`milestone` as absent; serde
//! reproduces that so the 400 contract is unchanged.

use serde::{Deserialize, Deserializer};
use serde_json::Value;

use super::types::{TodoPriority, TodoStatus, TodoType};

fn null_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

fn optional_text<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Ok(Value::deserialize(deserializer)?
        .as_str()
        .map(str::to_owned))
}

fn body_text<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    Ok(optional_text(deserializer)?.unwrap_or_default())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateTodo {
    pub project_id: String,
    pub title: String,
    #[serde(default, deserialize_with = "body_text")]
    pub body: String,
    #[serde(default, deserialize_with = "null_default")]
    pub status: TodoStatus,
    #[serde(default, rename = "type", deserialize_with = "null_default")]
    pub type_field: TodoType,
    #[serde(default, deserialize_with = "null_default")]
    pub priority: TodoPriority,
    #[serde(default, deserialize_with = "null_default")]
    pub labels: Vec<String>,
    #[serde(default, deserialize_with = "null_default")]
    pub assignees: Vec<String>,
    #[serde(default, deserialize_with = "optional_text")]
    pub milestone: Option<String>,
    #[serde(default, deserialize_with = "null_default")]
    pub dependencies: Vec<i64>,
}

impl CreateTodo {
    /// `TodoSchema.safeParse` — `None` (→ 400) on any failure, including an
    /// empty `projectId` or `title`.
    pub fn parse(value: Value) -> Option<Self> {
        let input: Self = serde_json::from_value(value).ok()?;
        (!input.title.is_empty() && !input.project_id.is_empty()).then_some(input)
    }
}

/// A partial update: every field is optional and `null` means "leave as is".
#[derive(Default, Deserialize)]
pub(crate) struct PatchTodo {
    pub title: Option<String>,
    pub body: Option<String>,
    pub status: Option<TodoStatus>,
    #[serde(rename = "type")]
    pub type_field: Option<TodoType>,
    pub priority: Option<TodoPriority>,
    pub labels: Option<Vec<String>>,
    pub assignees: Option<Vec<String>>,
    pub milestone: Option<String>,
    pub dependencies: Option<Vec<i64>>,
}

impl PatchTodo {
    /// A non-object body patches nothing (only `updated_at` moves); an empty
    /// `title` is the one value rejected outright.
    pub fn parse(value: &Value) -> Option<Self> {
        let input: Self = if value.is_object() {
            serde_json::from_value(value.clone()).ok()?
        } else {
            Self::default()
        };
        (!input.title.as_ref().is_some_and(String::is_empty)).then_some(input)
    }
}

#[derive(Deserialize)]
pub(crate) struct MoveTodo {
    pub status: TodoStatus,
}
