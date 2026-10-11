use mainframe_adapter_api::BoxFuture;
use mainframe_types::adapter::ExternalSessionPage;

pub(crate) struct Provider;

impl mainframe_adapter_api::ExternalSessions for Provider {
    fn list(
        &self,
        project: String,
        exclude: Vec<String>,
        offset: i64,
        limit: i64,
    ) -> BoxFuture<'_, ExternalSessionPage> {
        Box::pin(async move {
            crate::list_external_sessions(
                &project,
                &exclude,
                Some(offset.max(0) as usize),
                Some(limit.max(0) as usize),
                None,
            )
            .await
        })
    }
}
