use crate::message_parsing::ParsedCommand;
use mainframe_types::display::AskUserQuestionAnswer;
use serde_json::Value;
use std::collections::HashMap;

pub trait ToolResultDecoders: Send + Sync {
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

// A transcript can contain segments produced by several registered adapters.
pub struct DecoderSet(pub Vec<std::sync::Arc<dyn ToolResultDecoders>>);
impl ToolResultDecoders for DecoderSet {
    fn ask_user_question(
        &self,
        content: &str,
        input: Option<&HashMap<String, Value>>,
    ) -> Option<Vec<AskUserQuestionAnswer>> {
        self.0
            .iter()
            .find_map(|decoder| decoder.ask_user_question(content, input))
    }
    fn strip_command_tags(&self, text: &str) -> String {
        for decoder in &self.0 {
            let decoded = decoder.strip_command_tags(text);
            if decoded != text {
                return decoded;
            }
        }
        text.to_string()
    }
    fn parse_command(&self, text: &str) -> Option<ParsedCommand> {
        self.0
            .iter()
            .find_map(|decoder| decoder.parse_command(text))
    }
}
