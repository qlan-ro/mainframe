use super::*;
pub(super) fn id_or_nanoid(entry: &Value) -> String {
    entry
        .get("uuid")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| nanoid::nanoid!())
}
pub(super) fn uuid_or_nanoid_nullish(entry: &Value) -> String {
    entry
        .get("uuid")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| nanoid::nanoid!())
}
pub(super) fn timestamp_or_now(entry: &Value) -> String {
    entry
        .get("timestamp")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(now_iso8601)
}
pub(super) fn timestamp_or_now_nullish(entry: &Value) -> String {
    entry
        .get("timestamp")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(now_iso8601)
}
pub(super) fn history_meta() -> HashMap<String, Value> {
    HashMap::new()
}
pub(super) fn meta_or_none(meta: HashMap<String, Value>) -> Option<HashMap<String, Value>> {
    if meta.is_empty() { None } else { Some(meta) }
}
pub(super) fn base_dir_line_start(text: &str) -> Option<usize> {
    const LIT: &str = "Base directory for this skill:";
    let mut search_from = 0;
    while let Some(rel) = text[search_from..].find(LIT) {
        let idx = search_from + rel;
        if idx == 0 || text.as_bytes()[idx - 1] == b'\n' {
            return Some(idx);
        }
        search_from = idx + LIT.len();
    }
    None
}
pub(super) fn match_base_dir(text: &str) -> Option<String> {
    const LIT: &str = "Base directory for this skill:";
    let start = base_dir_line_start(text)?;
    let after = &text[start + LIT.len()..];
    let ws_chars: usize = after.chars().take_while(|c| c.is_whitespace()).count();
    let ws_bytes: usize = after.chars().take(ws_chars).map(char::len_utf8).sum();
    let rest = &after[ws_bytes..];
    let captured: String = rest.chars().take_while(|&c| c != '\n').collect();
    if captured.is_empty() {
        None
    } else {
        Some(captured)
    }
}
pub(super) fn strip_base_dir_line(text: &str) -> String {
    const LIT: &str = "Base directory for this skill:";
    let Some(start) = base_dir_line_start(text) else {
        return text.to_string();
    };
    let after = start + LIT.len();
    let line_end = text[after..]
        .find('\n')
        .map(|k| after + k + 1) // consume the newline (\n?)
        .unwrap_or(text.len());
    let mut out = String::with_capacity(text.len());
    out.push_str(&text[..start]);
    out.push_str(&text[line_end..]);
    out
}
pub(super) fn text_block(text: String) -> MessageContent {
    MessageContent::Leaf(LeafContent::Text {
        text,
        parent_tool_use_id: None,
    })
}
pub(super) fn value_object_to_map(v: Option<&Value>) -> HashMap<String, Value> {
    match v.and_then(Value::as_object) {
        Some(obj) => obj
            .iter()
            .map(|(k, val)| (k.clone(), val.clone()))
            .collect(),
        None => HashMap::new(),
    }
}
