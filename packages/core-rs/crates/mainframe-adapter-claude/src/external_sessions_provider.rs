use mainframe_adapter_api::BoxFuture;

pub(crate) struct Provider(pub(crate) crate::external_session_cache::ExternalSessionCache);

impl mainframe_adapter_api::ExternalSessions for Provider {
    fn list(
        &self,
        project: String,
        exclude: Vec<String>,
        offset: i64,
        limit: i64,
    ) -> BoxFuture<'_, mainframe_types::adapter::ExternalSessionPage> {
        Box::pin(async move {
            crate::external_sessions::list_external_sessions(
                &project,
                &exclude,
                Some(crate::external_sessions::ExternalSessionListOpts {
                    offset: Some(offset),
                    limit: Some(limit),
                }),
                &self.0,
            )
            .await
        })
    }
}
