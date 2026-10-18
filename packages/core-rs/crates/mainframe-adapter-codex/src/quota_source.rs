use mainframe_adapter_api::{AdapterError, BoxFuture, QuotaSource};
use mainframe_types::adapter::ProviderQuota;

pub struct Source;
impl QuotaSource for Source {
    fn push_is_snapshot(&self) -> bool {
        true
    }
    fn poll(&self) -> bool {
        false
    }
    fn pull(
        &self,
        binary: String,
        path: String,
    ) -> BoxFuture<'_, Result<ProviderQuota, AdapterError>> {
        Box::pin(async move {
            crate::quota_pull::pull_codex_quota_via_temp_app_server(&binary, &path).await
        })
    }
    fn identity(&self) -> BoxFuture<'_, Option<String>> {
        Box::pin(async {
            let identity = crate::read_codex_account_identity_from_disk().await;
            (identity != crate::CODEX_IDENTITY_TRANSIENT).then_some(identity)
        })
    }
}
