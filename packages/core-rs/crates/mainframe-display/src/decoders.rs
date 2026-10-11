use crate::message_parsing::ParsedCommand;
use mainframe_types::display::AskUserQuestionAnswer;
use serde_json::Value;
use std::collections::HashMap;

pub trait ToolResultDecoders: Send + Sync {
    fn prepare(&self, _messages: &[mainframe_types::chat::ChatMessage], _rewind: Option<usize>) {}
    fn for_message(
        &self,
        _message: &mainframe_types::chat::ChatMessage,
    ) -> Option<std::sync::Arc<dyn ToolResultDecoders>> {
        None
    }

    fn ask_user_question(
        &self,
        _content: &str,
        _input: Option<&HashMap<String, Value>>,
    ) -> Option<Vec<AskUserQuestionAnswer>> {
        None
    }
    fn strip_command_tags(&self, text: &str) -> String {
        text.to_string()
    }
    fn parse_command(&self, _text: &str) -> Option<ParsedCommand> {
        None
    }
}

pub struct NoopDecoders;
impl ToolResultDecoders for NoopDecoders {}

pub struct MainframeDecoders;
impl ToolResultDecoders for MainframeDecoders {
    fn ask_user_question(
        &self,
        content: &str,
        input: Option<&HashMap<String, Value>>,
    ) -> Option<Vec<AskUserQuestionAnswer>> {
        Some(
            crate::parse_ask_user_question::parse_ask_user_question_result(
                content,
                crate::display_helpers::extract_known_questions(input).as_deref(),
            ),
        )
    }
    fn strip_command_tags(&self, text: &str) -> String {
        crate::message_parsing::strip_mainframe_command_tags(text)
    }
    fn parse_command(&self, text: &str) -> Option<ParsedCommand> {
        crate::message_parsing::parse_command_message(text)
    }
}

pub struct DecoderSet {
    initial: String,
    adapters: HashMap<String, std::sync::Arc<dyn ToolResultDecoders>>,
    routes: std::sync::RwLock<Routes>,
}

#[derive(Default)]
struct Routes {
    ids: Vec<String>,
    adapters: HashMap<String, String>,
    current: String,
}

impl DecoderSet {
    pub fn new(
        initial: String,
        adapters: HashMap<String, std::sync::Arc<dyn ToolResultDecoders>>,
    ) -> Self {
        Self {
            initial,
            adapters,
            routes: Default::default(),
        }
    }
}

impl ToolResultDecoders for DecoderSet {
    fn prepare(&self, messages: &[mainframe_types::chat::ChatMessage], rewind: Option<usize>) {
        use mainframe_types::chat::{MessageContent, MessageContentNode};
        let mut routes = self.routes.write().unwrap_or_else(|e| e.into_inner());
        let start = rewind
            .unwrap_or(routes.ids.len())
            .min(routes.ids.len())
            .min(messages.len());
        while routes.ids.len() > start {
            if let Some(id) = routes.ids.pop() {
                routes.adapters.remove(&id);
            }
        }
        let mut adapter = routes
            .ids
            .last()
            .and_then(|id| routes.adapters.get(id))
            .unwrap_or(&self.initial)
            .clone();
        for message in &messages[start..] {
            for content in &message.content {
                if let MessageContent::Node(MessageContentNode::ProviderSwitch { marker }) = content
                {
                    adapter = marker.to_adapter_id.clone();
                }
            }
            routes.adapters.insert(message.id.clone(), adapter.clone());
            routes.ids.push(message.id.clone());
        }
        routes.current = adapter;
    }

    fn for_message(
        &self,
        message: &mainframe_types::chat::ChatMessage,
    ) -> Option<std::sync::Arc<dyn ToolResultDecoders>> {
        let routes = self.routes.read().unwrap_or_else(|e| e.into_inner());
        let adapter = routes.adapters.get(&message.id).unwrap_or(&routes.current);
        Some(
            self.adapters
                .get(adapter)
                .cloned()
                .unwrap_or_else(|| std::sync::Arc::new(NoopDecoders)),
        )
    }
}
