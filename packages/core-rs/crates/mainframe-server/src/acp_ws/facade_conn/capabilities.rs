use super::FacadeConnection;
use std::sync::atomic::Ordering;

impl FacadeConnection {
    pub(crate) fn is_negotiated(&self) -> bool {
        self.negotiated.load(Ordering::Relaxed)
    }

    pub(crate) fn mark_negotiated(&self) {
        self.negotiated.store(true, Ordering::Relaxed);
    }

    pub(crate) fn is_revision_cursors_opted_in(&self) -> bool {
        self.revision_cursors_opted_in.load(Ordering::Relaxed)
    }

    pub fn mark_revision_cursors_opted_in(&self) {
        self.revision_cursors_opted_in
            .store(true, Ordering::Relaxed);
    }

    pub(crate) fn is_replay_result_previews_opted_in(&self) -> bool {
        self.replay_result_previews_opted_in.load(Ordering::Relaxed)
    }

    pub(crate) fn mark_replay_result_previews_opted_in(&self) {
        self.replay_result_previews_opted_in
            .store(true, Ordering::Relaxed);
    }

    pub(crate) fn is_compressed_replay_opted_in(&self) -> bool {
        self.compressed_replay_opted_in.load(Ordering::Relaxed)
    }

    pub(crate) fn mark_compressed_replay_opted_in(&self) {
        self.compressed_replay_opted_in
            .store(true, Ordering::Relaxed);
    }

    pub(crate) fn is_windowed_history_opted_in(&self) -> bool {
        self.windowed_history_opted_in.load(Ordering::Relaxed)
    }

    pub(crate) fn mark_windowed_history_opted_in(&self) {
        self.windowed_history_opted_in
            .store(true, Ordering::Relaxed);
    }

    pub(crate) fn is_lazy_tool_images_opted_in(&self) -> bool {
        self.lazy_tool_images_opted_in.load(Ordering::Relaxed)
    }

    pub(crate) fn mark_lazy_tool_images_opted_in(&self) {
        self.lazy_tool_images_opted_in
            .store(true, Ordering::Relaxed);
    }
}
