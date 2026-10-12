use std::sync::Arc;

use mainframe_adapter_api::adapter::StopBackgroundTaskResult;
use mainframe_adapter_api::{AdapterError, AdapterSession, BoxFuture};
use mainframe_background_tasks::kill::{SessionLike, StopResult};

pub(crate) struct SessionKillBridge(pub(crate) Arc<dyn AdapterSession>);

impl SessionLike for SessionKillBridge {
    fn stop_background_task<'a>(&'a self, task_id: &'a str) -> BoxFuture<'a, StopResult> {
        let session = Arc::clone(&self.0);
        let task_id = task_id.to_string();
        Box::pin(async move { map_stop_result(session.stop_background_task(task_id).await) })
    }
}

fn map_stop_result(result: Result<StopBackgroundTaskResult, AdapterError>) -> StopResult {
    match result {
        Ok(result) => StopResult {
            ok: result.ok,
            error: result.error,
        },
        Err(error) => StopResult {
            ok: false,
            error: Some(error.to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_stop_result_and_maps_adapter_error() {
        let success = map_stop_result(Ok(StopBackgroundTaskResult {
            ok: true,
            error: None,
        }));
        assert!(success.ok);
        assert_eq!(success.error, None);
        let failure = map_stop_result(Err(AdapterError::Message("denied".into())));
        assert!(!failure.ok);
        assert_eq!(failure.error.as_deref(), Some("denied"));
    }
}
