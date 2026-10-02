use mainframe_types::command_execution::CommandExecutionMetadata;
use mainframe_types::display::{DisplayContent, DisplayNode};

pub(super) fn source_command_metadata(
    content: &[DisplayContent],
    tool_id: &str,
) -> Option<Box<CommandExecutionMetadata>> {
    content.iter().find_map(|block| match block {
        DisplayContent::Node(DisplayNode::ToolCall {
            id,
            command_execution,
            ..
        }) if id == tool_id => command_execution.clone(),
        _ => None,
    })
}
