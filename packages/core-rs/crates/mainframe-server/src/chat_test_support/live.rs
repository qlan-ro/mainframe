//! What a live stub's sessions share with the test driving them.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use mainframe_adapter_api::SessionSink;
use mainframe_types::adapter::ControlResponse;

/// What a live stub's sessions share with the test driving them.
#[derive(Default)]
pub(crate) struct LiveStub {
    pub(super) sinks: Mutex<HashMap<String, Arc<dyn SessionSink>>>,
    pub(super) answers: Mutex<Vec<ControlResponse>>,
}

impl LiveStub {
    /// The sink of the session spawned for `chat_id`.
    pub(crate) fn sink(&self, chat_id: &str) -> Arc<dyn SessionSink> {
        self.sinks.lock().unwrap()[chat_id].clone()
    }

    /// Every permission answer the sessions received, oldest first.
    pub(crate) fn answers(&self) -> Vec<ControlResponse> {
        self.answers.lock().unwrap().clone()
    }
}
