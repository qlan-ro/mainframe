use serde::{Deserialize, Deserializer};
use serde_json::Value;
use super::types::{TodoPriority, TodoStatus, TodoType};

fn null_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where D: Deserializer<'de>, T: Deserialize<'de> + Default {
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

fn optional_text<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Ok(Value::deserialize(deserializer)?.as_str().map(str::to_owned))
}

fn body_text<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    Ok(optional_text(deserializer)?.unwrap_or_default())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CreateTodo {
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
    pub fn parse(value: Value) -> Option<Self> {
        let input: Self = serde_json::from_value(value).ok()?;
        (!input.title.is_empty() && !input.project_id.is_empty()).then_some(input)
    }
}

#[derive(Default, Deserialize)]
pub(super) struct PatchTodo {
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
pub(super) struct MoveTodo {
    pub status: TodoStatus,
}
