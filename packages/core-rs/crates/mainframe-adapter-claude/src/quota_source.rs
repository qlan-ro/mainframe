use crate::quota_pull::{PullClaudeQuotaDeps, pull_claude_quota, spawn_claude_usage};
use mainframe_adapter_api::{AdapterError, BoxFuture, QuotaSource};
use mainframe_types::adapter::ProviderQuota;

pub struct Source;
impl QuotaSource for Source {
    fn pull(
        &self,
        binary: String,
        path: String,
    ) -> BoxFuture<'_, Result<ProviderQuota, AdapterError>> {
        Box::pin(async move {
            let run = move || -> BoxFuture<'static, Result<String, AdapterError>> {
                let binary = binary.clone();
                let path = path.clone();
                Box::pin(async move { spawn_claude_usage(&binary, &path).await })
            };
            pull_claude_quota(PullClaudeQuotaDeps {
                run_usage: &run,
                read_identity: None,
                now: mainframe_types::time::now_ms(),
            })
            .await
        })
    }
    fn identity(&self) -> BoxFuture<'_, Option<String>> {
        Box::pin(async {
            let identity = crate::trust_store::read_claude_account_identity(None).await;
            (identity != crate::trust_store::CLAUDE_IDENTITY_TRANSIENT).then_some(identity)
        })
    }
}
