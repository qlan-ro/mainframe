use mainframe_types::acp::update::SessionUpdate;
use mainframe_types::acp::{content::ContentBlock, tool_call::ToolCallContent};
use std::hash::{DefaultHasher, Hash, Hasher};

pub fn reference_images(chat_id: &str, update: &mut SessionUpdate) {
    let SessionUpdate::ToolCallUpdate(tool) = update else {
        return;
    };
    if !mainframe_types::ids::is_safe_identifier(chat_id)
        || !mainframe_types::ids::is_safe_identifier(&tool.tool_call_id)
    {
        return;
    }
    let Some(Some(content)) = &mut tool.content else {
        return;
    };
    let mut index = 0;
    for entry in content {
        if let ToolCallContent::Content {
            content: ContentBlock::Image { data, uri, .. },
        } = entry
        {
            if !data.is_empty() {
                let mut hash = DefaultHasher::new();
                data.hash(&mut hash);
                *uri = Some(format!(
                    "/api/chats/{chat_id}/tool-result/{}/images/{index}?v={:016x}",
                    tool.tool_call_id,
                    hash.finish()
                ));
                data.clear();
            }
            index += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn update(data: &str) -> SessionUpdate {
        serde_json::from_value(json!({
            "sessionUpdate": "tool_call_update", "toolCallId": "tool_1",
            "content": [
                {"type":"content","content":{"type":"text","text":"a screenshot"}},
                {"type":"content","content":{"type":"image","data":data,"mimeType":"image/png"}}
            ]
        }))
        .unwrap()
    }

    #[test]
    fn replaces_image_bytes_with_a_versioned_chat_scoped_reference() {
        let mut value = update(&"A".repeat(500_000));
        reference_images("chat_1", &mut value);
        let wire = serde_json::to_value(&value).unwrap();
        let image = &wire["content"][1]["content"];
        assert_eq!(image["data"], "");
        assert!(
            image["uri"]
                .as_str()
                .unwrap()
                .starts_with("/api/chats/chat_1/tool-result/tool_1/images/0?v=")
        );
        assert!(wire.to_string().len() < 500);
        assert_eq!(wire["content"][0]["content"]["text"], "a screenshot");
    }

    #[test]
    fn image_references_are_stable_and_change_when_the_pixels_change() {
        let mut one = update("AAAA");
        let mut same = update("AAAA");
        let mut changed = update("BBBB");
        reference_images("chat_1", &mut one);
        reference_images("chat_1", &mut same);
        reference_images("chat_1", &mut changed);
        assert_eq!(one, same);
        assert_ne!(one, changed);
    }

    #[test]
    fn leaves_unsafe_identifiers_inline_instead_of_creating_an_unfetchable_url() {
        let mut value = update("AAAA");
        let original = value.clone();
        reference_images("../other-chat", &mut value);
        assert_eq!(value, original);
    }
}
