use crate::adapter::ControlRequest;
use crate::display::{DisplayMessage, StreamingLeafKind};

pub struct ResumeSnapshot {
    pub messages: Vec<DisplayMessage>,
    pub streaming: Option<StreamingLeafKind>,
    pub pending: Option<ControlRequest>,
}
