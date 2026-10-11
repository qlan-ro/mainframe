use super::*;

impl ExternalSessionDeps for DaemonChatDeps {
    fn external_session_adapter_ids(&self) -> Vec<String> {
        self.adapters
            .get_all()
            .into_iter()
            .filter(|adapter| adapter.external_sessions().is_some())
            .map(|adapter| adapter.id().to_string())
            .collect()
    }
    fn list_external_sessions<'a>(
        &'a self,
        adapter_id: &'a str,
        project_path: &'a str,
        exclude_ids: &'a [String],
        offset: i64,
        limit: i64,
    ) -> BoxFuture<'a, Result<ExternalSessionPage, AdapterError>> {
        Box::pin(async move {
            let Some(adapter) = self
                .adapters
                .get(adapter_id)
                .and_then(|adapter| adapter.external_sessions())
            else {
                tracing::warn!(adapter_id, "list_external_sessions: unknown adapter id");
                return Ok(ExternalSessionPage {
                    sessions: Vec::new(),
                    total: 0,
                    next_offset: None,
                });
            };
            Ok(adapter
                .list(
                    project_path.to_string(),
                    exclude_ids.to_vec(),
                    offset,
                    limit,
                )
                .await)
        })
    }
}
