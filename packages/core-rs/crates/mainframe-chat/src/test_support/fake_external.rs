use super::FakeDeps;
use crate::external_session_service::ExternalSessionDeps;
use mainframe_adapter_api::{AdapterError, BoxFuture};
use mainframe_types::adapter::ExternalSessionPage;
use mainframe_types::sync::LockExt as _;

impl ExternalSessionDeps for FakeDeps {
    fn external_session_adapter_ids(&self) -> Vec<String> {
        vec!["claude".into()]
    }
    fn list_external_sessions<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
        _: &'a [String],
        _: i64,
        _: i64,
    ) -> BoxFuture<'a, Result<ExternalSessionPage, AdapterError>> {
        let sessions = self.external_sessions.lock_recover().clone();
        let total = sessions.len() as i64;
        Box::pin(async move {
            Ok(ExternalSessionPage {
                sessions,
                total,
                next_offset: None,
            })
        })
    }
}
