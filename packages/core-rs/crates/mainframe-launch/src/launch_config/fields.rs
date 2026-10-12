use super::*;

pub(super) fn parse_runtime_executable(
    obj: &serde_json::Map<String, Value>,
    issues: &mut Vec<&'static str>,
) -> String {
    match obj.get("runtimeExecutable").and_then(Value::as_str) {
        Some(v) if !v.is_empty() => {
            if is_safe_executable(v) {
                v.to_string()
            } else {
                issues
                    .push("runtimeExecutable must be a safe executable name (no shell operators)");
                v.to_string()
            }
        }
        _ => {
            issues.push("runtimeExecutable must be a non-empty string");
            String::new()
        }
    }
}

pub(super) fn parse_runtime_args(
    obj: &serde_json::Map<String, Value>,
    issues: &mut Vec<&'static str>,
) -> Vec<String> {
    // runtimeArgs: array of strings, optional, default [].

    match obj.get("runtimeArgs") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(items)) => {
            let mut args = Vec::with_capacity(items.len());
            for arg in items {
                match arg.as_str() {
                    Some(s) => args.push(s.to_string()),
                    None => issues.push("runtimeArgs must be an array of strings"),
                }
            }
            args
        }
        Some(_) => {
            issues.push("runtimeArgs must be an array of strings");
            Vec::new()
        }
    }
}

pub(super) fn parse_preview(value: Option<&Value>, issues: &mut Vec<&'static str>) -> Option<bool> {
    match value {
        None | Some(Value::Null) => None,
        Some(Value::Bool(b)) => Some(*b),
        Some(_) => {
            issues.push("preview must be a boolean");
            None
        }
    }
}
