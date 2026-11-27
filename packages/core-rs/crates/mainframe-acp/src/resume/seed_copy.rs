use mainframe_types::display::{DisplayMessage, StreamingLeafKind};

/// An owned copy of the display list and streaming overlay a reply was built
/// from, taken inside the same snapshot read when `ResumeOptions::defer_log_seed`
/// left the revision log unseeded. The caller seeds the log from it, so the
/// baseline is what the reply actually sent and never a later state.
pub struct SeedCopy {
    pub messages: Vec<DisplayMessage>,
    pub streaming: Option<StreamingLeafKind>,
}
