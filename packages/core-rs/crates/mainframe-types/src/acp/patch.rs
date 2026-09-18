//! Serde helper for ACP's patch-field convention (todo #350, ACP-EVALUATION.md
//! "What to borrow" #1): on an upsert/patch frame, an **omitted** key leaves
//! the field unchanged, `null` clears it, and a value replaces it. A bare
//! `Option<T>` cannot distinguish omitted from explicit `null` — both
//! deserialize to `None` — so patch fields use `Option<Option<T>>` with this
//! module as their `#[serde(with = "patch")]` implementation, paired with
//! `#[serde(default, skip_serializing_if = "patch::is_absent")]`.
//!
//! `default` supplies `None` (omitted) when the key is missing, so
//! `deserialize` below only ever runs for a key that *is* present, and
//! therefore only ever needs to distinguish `null` from a value.

use serde::{Deserialize, Deserializer, Serialize, Serializer};

pub fn is_absent<T>(value: &Option<Option<T>>) -> bool {
    value.is_none()
}

pub fn serialize<T, S>(value: &Option<Option<T>>, serializer: S) -> Result<S::Ok, S::Error>
where
    T: Serialize,
    S: Serializer,
{
    match value {
        Some(inner) => inner.serialize(serializer),
        None => serializer.serialize_none(),
    }
}

pub fn deserialize<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    let inner: Option<T> = Option::deserialize(deserializer)?;
    Ok(Some(inner))
}

#[cfg(test)]
mod tests {
    use serde::{Deserialize, Serialize};
    use serde_json::json;

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    struct Patchable {
        #[serde(default, skip_serializing_if = "super::is_absent", with = "super")]
        field: Option<Option<String>>,
    }

    #[test]
    fn omitted_key_deserializes_to_outer_none() {
        let parsed: Patchable = serde_json::from_value(json!({})).unwrap();
        assert_eq!(parsed.field, None);
    }

    #[test]
    fn null_deserializes_to_some_none() {
        let parsed: Patchable = serde_json::from_value(json!({ "field": null })).unwrap();
        assert_eq!(parsed.field, Some(None));
    }

    #[test]
    fn value_deserializes_to_some_some() {
        let parsed: Patchable = serde_json::from_value(json!({ "field": "x" })).unwrap();
        assert_eq!(parsed.field, Some(Some("x".to_string())));
    }

    #[test]
    fn omitted_field_is_not_serialized() {
        let v = serde_json::to_value(Patchable { field: None }).unwrap();
        assert_eq!(v, json!({}));
    }

    #[test]
    fn cleared_field_serializes_to_null() {
        let v = serde_json::to_value(Patchable { field: Some(None) }).unwrap();
        assert_eq!(v, json!({ "field": null }));
    }

    #[test]
    fn replaced_field_serializes_to_value() {
        let v = serde_json::to_value(Patchable {
            field: Some(Some("x".to_string())),
        })
        .unwrap();
        assert_eq!(v, json!({ "field": "x" }));
    }
}
