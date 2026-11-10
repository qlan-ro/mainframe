/// Which out-of-band notification [`FacadeHub::push_notification`] is
/// carrying, for logs. A gate raise is not here: it serializes its own frame,
/// because registration has to run between the serialize and the send.
#[derive(Clone, Copy)]
pub(super) enum RawFrameKind {
    QueueState,
    TranscriptCleared,
    Resync,
    Compaction,
    RetryStatus,
}

impl RawFrameKind {
    /// The frame family, for logs.
    pub(super) fn label(self) -> &'static str {
        match self {
            RawFrameKind::QueueState => "queue_state",
            RawFrameKind::TranscriptCleared => "transcript_cleared",
            RawFrameKind::Resync => "resync",
            RawFrameKind::Compaction => "compaction",
            RawFrameKind::RetryStatus => "retry_status",
        }
    }
}
