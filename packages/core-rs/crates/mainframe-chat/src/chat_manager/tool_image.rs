use super::ChatManager;
use mainframe_types::content::ToolResultImage;
use mainframe_types::display::{DisplayContent, DisplayNode};

impl ChatManager {
    pub async fn get_tool_result_image(
        &self,
        chat_id: &str,
        tool_id: &str,
        index: usize,
    ) -> Option<ToolResultImage> {
        self.read_resume_snapshot(chat_id, |messages, _, _| {
            messages
                .iter()
                .find_map(|message| find_image(&message.content, tool_id, index).cloned())
        })
        .await
    }
}

fn find_image<'a>(
    content: &'a [DisplayContent],
    tool_id: &str,
    index: usize,
) -> Option<&'a ToolResultImage> {
    content.iter().find_map(|entry| match entry {
        DisplayContent::Node(DisplayNode::ToolCall { id, result, .. }) if id == tool_id => {
            result.as_ref()?.images.get(index)
        }
        DisplayContent::Node(DisplayNode::TaskGroup {
            agent_id, result, ..
        }) if agent_id == tool_id => result.as_ref()?.images.get(index),
        DisplayContent::Node(
            DisplayNode::ToolGroup { calls } | DisplayNode::TaskGroup { calls, .. },
        ) => find_image(calls, tool_id, index),
        DisplayContent::Node(DisplayNode::TaskProgress { items }) => items
            .iter()
            .find(|item| item.id == tool_id)?
            .result
            .as_ref()?
            .images
            .get(index),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn finds_the_requested_nested_tool_image_without_returning_other_results() {
        let content: Vec<DisplayContent> = serde_json::from_value(json!([
            {"type":"task_group","agentId":"agent","taskArgs":{},"calls":[
                {"type":"tool_group","calls":[
                    {"type":"tool_call","id":"tool_1","name":"Read","input":{},
                    "category":"default","result":{"content":"shot","isError":false,
                        "images":[{"mediaType":"image/png","data":"AAAA"},
                            {"mediaType":"image/jpeg","data":"BBBB"}]}}
                ]}
            ]}
        ]))
        .unwrap();
        assert_eq!(find_image(&content, "tool_1", 1).unwrap().data, "BBBB");
        assert!(find_image(&content, "tool_1", 2).is_none());
        assert!(find_image(&content, "another_tool", 0).is_none());
    }

    #[test]
    fn resolves_images_emitted_by_progress_tools() {
        let content = serde_json::from_value::<Vec<DisplayContent>>(json!([
            {"type":"task_progress","items":[
                {"id":"progress","name":"Read","input":{},"category":"progress",
                    "result":{"content":"shot","isError":false,
                        "images":[{"mediaType":"image/png","data":"CCCC"}]}}
            ]}
        ]))
        .unwrap();
        assert_eq!(find_image(&content, "progress", 0).unwrap().data, "CCCC");
        assert!(find_image(&content, "progress", 1).is_none());
        assert!(find_image(&content, "missing", 0).is_none());
    }
}
