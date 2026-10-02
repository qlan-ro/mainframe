use crate::history::{bash_input, tool_use_block};
use crate::item_types::CommandExecutionItem;
use mainframe_types::chat::{MessageContent, MessageContentNode};
use mainframe_types::command_execution::{CommandAction, CommandExecutionMetadata};
use serde::{Deserialize, Deserializer};
use serde_json::Value;

pub(crate) fn actions<'de, D: Deserializer<'de>>(
    d: D,
) -> Result<Option<Vec<CommandAction>>, D::Error> {
    let value = Value::deserialize(d)?;
    Ok(value.as_array().map(|items| {
        items
            .iter()
            .map(|item| {
                serde_json::from_value(item.clone()).unwrap_or_else(|_| CommandAction::Unknown {
                    command: item
                        .get("command")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                })
            })
            .collect()
    }))
}

pub(crate) fn duration<'de, D: Deserializer<'de>>(d: D) -> Result<Option<i64>, D::Error> {
    Ok(Value::deserialize(d)?.as_i64())
}

pub(crate) fn output<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    Ok(Option::<String>::deserialize(d)?.unwrap_or_default())
}

pub(crate) fn metadata(item: &CommandExecutionItem) -> Option<CommandExecutionMetadata> {
    if item.command_actions.is_none() && item.duration_ms.is_none() {
        return None;
    }
    Some(CommandExecutionMetadata {
        command_actions: item.command_actions.clone(),
        reported_duration_ms: item.duration_ms,
    })
}

pub(crate) fn tool_block(item: &CommandExecutionItem) -> MessageContent {
    let mut block = tool_use_block(&item.id, "Bash", bash_input(&item.command));
    if let MessageContent::Node(MessageContentNode::ToolUse {
        command_execution, ..
    }) = &mut block
    {
        *command_execution = metadata(item);
    }
    block
}
