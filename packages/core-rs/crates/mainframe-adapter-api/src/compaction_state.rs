use crate::{AdapterError, idle_compaction::*};
use mainframe_types::sync::LockExt as _;
use std::sync::Mutex;
use tokio::sync::oneshot;

type Outcome = Result<CompactionMetadata, AdapterError>;
#[derive(Debug, Default)]
pub struct CompactionState {
    inner: Mutex<State>,
}
#[derive(Debug, Default)]
struct State {
    request: Option<NativeCompactionRequest>,
    metadata: Option<CompactionMetadata>,
    sender: Option<oneshot::Sender<Outcome>>,
    busy: bool,
    quarantined: bool,
}
impl CompactionState {
    pub fn begin(
        &self,
        request: NativeCompactionRequest,
    ) -> Result<oneshot::Receiver<Outcome>, AdapterError> {
        let mut state = self.inner.lock_recover();
        if state.busy {
            return Err(AdapterError::Message(
                "provider is not ready for compaction".into(),
            ));
        }
        let (sender, receiver) = oneshot::channel();
        *state = State {
            request: Some(request),
            sender: Some(sender),
            busy: true,
            ..State::default()
        };
        Ok(receiver)
    }
    pub fn ready(&self) -> bool {
        !self.inner.lock_recover().busy
    }
    pub fn request(&self) -> Option<NativeCompactionRequest> {
        self.inner.lock_recover().request.clone()
    }
    pub fn suppressing(&self) -> bool {
        self.inner.lock_recover().busy
    }
    pub fn quarantined(&self) -> bool {
        self.inner.lock_recover().quarantined
    }
    pub fn record(&self, metadata: CompactionMetadata) -> bool {
        let mut state = self.inner.lock_recover();
        if state.metadata.is_some()
            || state.quarantined
            || !state.request.as_ref().is_some_and(|request| {
                request.id == metadata.request_id
                    && request.session_generation == metadata.session_generation
            })
        {
            return false;
        }
        state.metadata = Some(metadata);
        true
    }
    pub fn finish(&self, success: bool) {
        let mut state = self.inner.lock_recover();
        if let Some(sender) = state.sender.take() {
            let outcome =
                state.metadata.take().filter(|_| success).ok_or_else(|| {
                    AdapterError::Message("native compaction did not complete".into())
                });
            let _ = sender.send(outcome);
        }
        *state = State::default();
    }
    pub fn timeout(&self) {
        let mut state = self.inner.lock_recover();
        state.request = None;
        state.sender = None;
        state.quarantined = true;
    }
    pub async fn wait(&self, receiver: oneshot::Receiver<Outcome>, timeout_ms: u64) -> Outcome {
        match tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), receiver).await {
            Ok(Ok(outcome)) => outcome,
            _ => {
                self.timeout();
                Err(AdapterError::Message(
                    "native compaction completion timed out".into(),
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(id: &str) -> NativeCompactionRequest {
        NativeCompactionRequest {
            id: id.into(),
            session_generation: "session".into(),
            origin: CompactionOrigin::Idle,
            command_uuid: "uuid".into(),
        }
    }
    #[tokio::test]
    async fn ack_is_not_completion_and_timeout_quarantines_late_events() {
        let state = CompactionState::default();
        let mut rx = state.begin(request("one")).unwrap();
        assert!(rx.try_recv().is_err());
        assert!(!state.ready());
        assert!(state.wait(rx, 1).await.is_err());
        assert!(state.request().is_none());
        assert!(!state.ready());
        assert!(state.begin(request("two")).is_err());
        assert!(!state.record(request("one").metadata(Some("late"))));
        state.finish(true);
        assert!(state.ready());
        let rx = state.begin(request("two")).unwrap();
        let metadata = request("two").metadata(Some("current"));
        assert!(state.record(metadata.clone()));
        assert!(!state.record(metadata.clone()));
        state.finish(true);
        assert_eq!(state.wait(rx, 10).await.unwrap(), metadata);
    }
    #[tokio::test]
    async fn terminal_failure_and_exit_never_fabricate_success() {
        let state = CompactionState::default();
        let rx = state.begin(request("one")).unwrap();
        state.finish(false);
        assert!(state.wait(rx, 10).await.is_err());
        assert!(state.ready());
    }
}
