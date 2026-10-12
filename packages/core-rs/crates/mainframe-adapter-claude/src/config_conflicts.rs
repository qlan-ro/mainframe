use serde_json::Value;

fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::String(s) => !s.is_empty(),
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::Array(_) | Value::Object(_) => true,
    }
}

pub async fn read() -> Vec<String> {
    let mut conflicts: Vec<&str> = Vec::new();
    if let Some(home) = dirs::home_dir() {
        let settings_path = home.join(".claude").join("settings.json");
        if let Ok(raw) = tokio::fs::read_to_string(&settings_path).await
            && let Ok(settings) = serde_json::from_str::<Value>(&raw)
            && let Some(permissions) = settings.get("permissions")
        {
            if permissions.get("defaultMode").is_some_and(is_truthy) {
                conflicts.push("defaultMode");
            }
            if permissions.get("allow").is_some_and(is_truthy) {
                conflicts.push("allowedTools");
            }
            if permissions.get("deny").is_some_and(is_truthy) {
                conflicts.push("deniedTools");
            }
        }
    }
    conflicts.into_iter().map(str::to_string).collect()
}
