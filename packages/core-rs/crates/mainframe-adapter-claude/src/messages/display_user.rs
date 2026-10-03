use super::display_helpers::with_parent_id;
use super::message_parsing::{parse_attached_file_path_tags, parse_command_message};
use mainframe_types::chat::MessageContent;
use mainframe_types::content::LeafContent;
use mainframe_types::display::DisplayContent;
use serde_json::{Value, json};
use std::collections::HashMap;

pub fn convert_user_content(
    content: &[MessageContent],
) -> (Vec<DisplayContent>, HashMap<String, Value>) {
    let mut metadata: HashMap<String, Value> = HashMap::new();
    let mut display_content: Vec<DisplayContent> = Vec::new();

    for block in content {
        match block {
            MessageContent::Leaf(LeafContent::Text {
                text,
                parent_tool_use_id,
            }) => {
                convert_user_text(
                    text,
                    parent_tool_use_id,
                    &mut display_content,
                    &mut metadata,
                );
            }
            MessageContent::Leaf(LeafContent::Image {
                media_type,
                data,
                parent_tool_use_id,
            }) => {
                display_content.push(DisplayContent::Leaf(LeafContent::Image {
                    media_type: media_type.clone(),
                    data: data.clone(),
                    parent_tool_use_id: with_parent_id(parent_tool_use_id),
                }));
            }
            _ => {}
        }
    }

    (display_content, metadata)
}

fn convert_user_text(
    text: &str,
    parent_tool_use_id: &Option<String>,
    display_content: &mut Vec<DisplayContent>,
    metadata: &mut HashMap<String, Value>,
) {
    if text.is_empty() || text.starts_with("[Request interrupted") {
        return;
    }

    if parse_user_command(text, parent_tool_use_id, display_content, metadata) {
        return;
    }

    let parsed = parse_attached_file_path_tags(text);
    if !parsed.files.is_empty() {
        let files: Vec<Value> = parsed
            .files
            .iter()
            .map(|f| json!({ "name": f.name }))
            .collect();
        metadata.insert("attachedFiles".to_string(), Value::Array(files));
    }

    let text_to_store = if !parsed.files.is_empty() {
        parsed.clean_text
    } else {
        text.to_string()
    };

    if !text_to_store.is_empty() {
        display_content.push(DisplayContent::Leaf(LeafContent::Text {
            text: text_to_store,
            parent_tool_use_id: with_parent_id(parent_tool_use_id),
        }));
    }
}

fn parse_user_command(
    text: &str,
    parent_tool_use_id: &Option<String>,
    display_content: &mut Vec<DisplayContent>,
    metadata: &mut HashMap<String, Value>,
) -> bool {
    if let Some(cmd_info) = parse_command_message(text) {
        // Only synthesize a user bubble when the raw text includes a
        // <command-message> tag (present exclusively for user-typed slash
        // commands). Bare <command-name>…</command-name> echoes are internal
        // CLI metadata → suppressed.
        if !text.contains("<command-message>") {
            return true;
        }

        metadata.insert(
            "command".to_string(),
            json!({ "name": cmd_info.command_name, "userText": cmd_info.user_text }),
        );
        metadata.insert("cleanText".to_string(), json!(cmd_info.user_text));
        let args = cmd_info.user_text.trim();
        let rendered = if !args.is_empty() {
            format!("/{} {}", cmd_info.command_name, args)
        } else {
            format!("/{}", cmd_info.command_name)
        };
        display_content.push(DisplayContent::Leaf(LeafContent::Text {
            text: rendered,
            parent_tool_use_id: with_parent_id(parent_tool_use_id),
        }));
        return true;
    }

    false
}
