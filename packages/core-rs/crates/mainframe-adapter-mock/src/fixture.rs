use mainframe_adapter_api::AdapterError;
use mainframe_types::chat::{ChatMessage, ChatMessageType, MessageContent};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventDirection {
    In,
    Out,
    Fx,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedFile {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedEvent {
    pub dir: EventDirection,
    pub method: String,
    pub args: Vec<Value>,
    pub delay_ms: i64,
    #[serde(default)]
    pub files: Vec<RecordedFile>,
    #[serde(default)]
    pub deleted: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct ReplayState {
    pub events: Vec<RecordedEvent>,
    pub cursor: usize,
}

impl ReplayState {
    pub fn new(events: Vec<RecordedEvent>) -> Self {
        Self { events, cursor: 0 }
    }

    pub fn is_exhausted(&self) -> bool {
        self.cursor >= self.events.len()
    }

    pub fn consume_input(&mut self) -> Option<RecordedEvent> {
        let event = self.events.get(self.cursor)?;
        if event.dir != EventDirection::In {
            return None;
        }
        self.cursor += 1;
        Some(event.clone())
    }

    pub fn drain_outputs(&mut self) -> Vec<RecordedEvent> {
        let start = self.cursor;
        while self.cursor < self.events.len() && self.events[self.cursor].dir != EventDirection::In
        {
            self.cursor += 1;
        }
        self.events[start..self.cursor].to_vec()
    }

    pub fn drain_optional_interrupts(&mut self) -> Vec<RecordedEvent> {
        let mut drained = Vec::new();
        while self.peek_input("interrupt") {
            self.cursor += 1;
            drained.extend(self.drain_outputs());
        }
        drained
    }

    pub fn peek_input(&self, method: &str) -> bool {
        self.events
            .get(self.cursor)
            .map(|event| event.dir == EventDirection::In && event.method == method)
            .unwrap_or(false)
    }
}

pub fn parse_fixture(text: &str) -> Result<Vec<RecordedEvent>, AdapterError> {
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            serde_json::from_str(line).map_err(|error| {
                AdapterError::Message(format!("mock-cli: invalid fixture: {error}"))
            })
        })
        .collect()
}

pub(crate) fn messages_from_events(events: &[RecordedEvent], chat_id: &str) -> Vec<ChatMessage> {
    events
        .iter()
        .enumerate()
        .filter_map(|(index, event)| event_message(event, index, chat_id))
        .collect()
}

fn event_message(event: &RecordedEvent, index: usize, chat_id: &str) -> Option<ChatMessage> {
    let r#type = match (event.dir.clone(), event.method.as_str()) {
        (EventDirection::Out, "onMessage") => ChatMessageType::Assistant,
        (EventDirection::Out, "onToolResult") => ChatMessageType::ToolResult,
        _ => return None,
    };
    let content =
        serde_json::from_value::<Vec<MessageContent>>(event.args.first()?.clone()).ok()?;
    Some(ChatMessage {
        id: format!("mock-history-{index}"),
        chat_id: chat_id.to_string(),
        r#type,
        content,
        timestamp: String::new(),
        metadata: None,
    })
}
