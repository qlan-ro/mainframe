use crate::{AdapterError, BoxFuture};
use mainframe_types::adapter::ProviderQuota;

pub trait QuotaSource: Send + Sync {
    fn merge_sparse(&self) -> bool {
        false
    }
    fn poll(&self) -> bool {
        true
    }
    fn pull(
        &self,
        binary: String,
        path: String,
    ) -> BoxFuture<'_, Result<ProviderQuota, AdapterError>>;
    fn identity(&self) -> BoxFuture<'_, Option<String>>;
}
