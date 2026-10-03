use super::*;
pub(super) struct SkillBlock {
    pub(super) skill_name: String,
    pub(super) path: String,
    pub(super) content: String,
    pub(super) parent_tool_use_id: Option<String>,
}

impl SkillBlock {
    pub(super) fn to_value(&self) -> Value {
        let mut v = json!({
            "type": "skill_loaded",
            "skillName": self.skill_name,
            "path": self.path,
            "content": self.content,
        });
        if let Some(p) = &self.parent_tool_use_id {
            v["parentToolUseId"] = Value::String(p.clone());
        }
        v
    }
}

pub(super) fn event_bool(event: &Value, keys: &[&str]) -> bool {
    keys.iter()
        .any(|k| event.get(*k).and_then(Value::as_bool) == Some(true))
}
pub(super) fn command_name(text: &str) -> Option<String> {
    let start = text.find("<command-name>")? + "<command-name>".len();
    let rest = &text[start..];
    let end = rest.find("</command-name>")?;
    let inner = &rest[..end];
    if inner.contains('<') {
        return None; // `[^<]+` forbids `<`
    }
    let inner = inner.strip_prefix('/').unwrap_or(inner).trim();
    if inner.is_empty() {
        None
    } else {
        Some(inner.to_string())
    }
}
pub(super) fn base_dir(text: &str) -> Option<String> {
    const PREFIX: &str = "Base directory for this skill:";
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix(PREFIX) {
            let v = rest.trim();
            if !v.is_empty() {
                return Some(v.to_string());
            }
        }
    }
    None
}
pub(super) fn strip_tag(text: &str, tag: &str) -> String {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut out = String::new();
    let mut rest = text;
    while let Some(i) = rest.find(&open) {
        let after_open = &rest[i + open.len()..];
        if let Some(j) = after_open.find(&close) {
            let inner = &after_open[..j];
            if !inner.contains('<') {
                out.push_str(&rest[..i]);
                let mut tail = &after_open[j + close.len()..];
                tail = tail.strip_prefix('\n').unwrap_or(tail);
                rest = tail;
                continue;
            }
        }
        out.push_str(&rest[..i + open.len()]);
        rest = &rest[i + open.len()..];
    }
    out.push_str(rest);
    out
}
pub(super) fn strip_base_dir_line(text: &str) -> String {
    const PREFIX: &str = "Base directory for this skill:";
    let mut result = String::with_capacity(text.len());
    let mut removed = false;
    let mut chars = text;
    while !chars.is_empty() {
        let line_end = chars.find('\n').map(|i| i + 1).unwrap_or(chars.len());
        let line = &chars[..line_end];
        if !removed && line.trim_end_matches('\n').starts_with(PREFIX) {
            removed = true; // drop this line (incl. its newline)
        } else {
            result.push_str(line);
        }
        chars = &chars[line_end..];
    }
    result
}

pub(super) fn extract_skill_block(
    text: &str,
    project_path: &str,
    cache: &mut HashMap<String, String>,
    parent_tool_use_id: Option<&str>,
) -> Option<SkillBlock> {
    let has_skill_format = text.contains("<skill-format>true</skill-format>");
    let base_dir_match = base_dir(text);
    if !has_skill_format && base_dir_match.is_none() {
        return None;
    }

    let raw_dir = base_dir_match.unwrap_or_default();
    let skill_name = skill_name(text, &raw_dir);
    if skill_name.is_empty() {
        return None;
    }

    let resolved_path =
        if !raw_dir.is_empty() && std::path::Path::new(&raw_dir).extension().is_none() {
            std::path::Path::new(&raw_dir)
                .join("SKILL.md")
                .to_string_lossy()
                .to_string()
        } else {
            raw_dir.clone()
        };
    let final_path = if !resolved_path.is_empty() {
        resolved_path
    } else {
        resolve_skill_path(Some(project_path), &skill_name, Some(cache))
    };
    cache.insert(skill_name.clone(), final_path.clone());

    let content = strip_tag(text, "command-message");
    let content = strip_tag(&content, "command-name");
    let content = strip_tag(&content, "skill-format");
    let content = strip_base_dir_line(&content);
    let content = content.trim().to_string();

    Some(SkillBlock {
        skill_name,
        path: final_path,
        content,
        parent_tool_use_id: parent_tool_use_id.map(str::to_string),
    })
}

fn skill_name(text: &str, raw_dir: &str) -> String {
    let name_from_tag = command_name(text);
    match name_from_tag {
        Some(n) => n,
        None => {
            if raw_dir.is_empty() {
                String::new()
            } else {
                std::path::Path::new(&raw_dir)
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default()
            }
        }
    }
}
