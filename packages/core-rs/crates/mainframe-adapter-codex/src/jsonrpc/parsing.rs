use super::*;

/// `findJsonObjectEnd` — index one past the end of the first complete top-level
/// JSON object in `input`, or `None` if there isn't one. Copied char-for-char.
pub(super) fn find_json_object_end(input: &str) -> Option<usize> {
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;

    for (i, ch) in input.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        if ch == '"' {
            in_string = true;
        } else if ch == '{' {
            depth += 1;
        } else if ch == '}' {
            depth -= 1;
            if depth == 0 {
                return Some(i + ch.len_utf8());
            }
        } else if depth == 0 && !ch.is_whitespace() {
            return None;
        }
    }

    None
}

/// Parse one stdout line into 1+ JSON objects (the app-server occasionally
/// concatenates objects on a single line). Errors if a partial object is found.
pub(super) fn parse_jsonrpc_messages(line: &str) -> Result<Vec<Map<String, Value>>, JsonRpcError> {
    let mut messages: Vec<Map<String, Value>> = Vec::new();
    let mut rest = line.trim();

    while !rest.is_empty() {
        match serde_json::from_str::<Value>(rest) {
            Ok(Value::Object(m)) => {
                messages.push(m);
                return Ok(messages);
            }
            Ok(_) => return Ok(messages),
            Err(_) => {
                let end = find_json_object_end(rest)
                    .ok_or_else(|| JsonRpcError("No complete JSON object found".to_string()))?;
                match serde_json::from_str::<Value>(&rest[..end]) {
                    Ok(Value::Object(m)) => messages.push(m),
                    _ => return Err(JsonRpcError("No complete JSON object found".to_string())),
                }
                rest = rest[end..].trim();
                if !rest.starts_with('{') {
                    return Ok(messages);
                }
            }
        }
    }

    Ok(messages)
}

pub(super) fn request_id_from_value(v: &Value) -> Option<RequestId> {
    match v {
        Value::Number(n) => n.as_i64().map(RequestId::Number),
        Value::String(s) => Some(RequestId::String(s.clone())),
        _ => None,
    }
}
