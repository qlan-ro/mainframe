//! Lenient field reads for the CLI's workflow JSON. The CLI's shape is not
//! ours to control, so a missing or wrongly typed field degrades to `None` or a
//! default for that field alone instead of failing the whole entry, which a
//! derived `Deserialize` would do.

use serde_json::Value;

pub(crate) fn opt_str(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

pub(crate) fn str_or_empty(value: &Value, key: &str) -> String {
    opt_str(value, key).unwrap_or_default()
}

pub(crate) fn opt_i64(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(Value::as_i64)
}

pub(crate) fn i64_or_zero(value: &Value, key: &str) -> i64 {
    opt_i64(value, key).unwrap_or(0)
}
