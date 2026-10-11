use super::*;

/// The daemon-side `ExternalSessionDeps`. `list_external_sessions` is not on
/// the `Adapter` trait (see the TODO in `mainframe-adapter-api`), so this
/// dispatches to the concrete Claude/Codex scan functions directly by adapter
/// id rather than through the registry.
impl ExternalSessionDeps for DaemonChatDeps {
    /// `adapters.getAll().filter(a => a.listExternalSessions)` — the claude/codex
    /// scan functions are free functions (not on the polymorphic `Adapter`
    /// trait), so registration is keyed by id rather than a capability check.
    fn external_session_adapter_ids(&self) -> Vec<String> {
        self.adapters
            .get_all()
            .into_iter()
            .map(|a| a.id().to_string())
            .filter(|id| id == "claude" || id == "codex")
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
        let adapter_id = adapter_id.to_string();
        let project_path = project_path.to_string();
        let exclude_ids = exclude_ids.to_vec();
        Box::pin(async move {
            let page = match adapter_id.as_str() {
                "claude" => {
                    mainframe_adapter_claude::external_sessions::list_external_sessions(
                        &project_path,
                        &exclude_ids,
                        Some(ExternalSessionListOpts {
                            offset: Some(offset),
                            limit: Some(limit),
                        }),
                        &self.claude_external_session_cache,
                    )
                    .await
                }
                "codex" => {
                    mainframe_adapter_codex::list_external_sessions(
                        &project_path,
                        &exclude_ids,
                        Some(offset.max(0) as usize),
                        Some(limit.max(0) as usize),
                        None,
                    )
                    .await
                }
                other => {
                    tracing::warn!(
                        adapter_id = other,
                        "list_external_sessions: unknown adapter id"
                    );
                    ExternalSessionPage {
                        sessions: Vec::new(),
                        total: 0,
                        next_offset: None,
                    }
                }
            };
            Ok(page)
        })
    }
}
