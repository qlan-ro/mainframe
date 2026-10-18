use crate::{AdapterError, BoxFuture};
use mainframe_types::adapter::ProviderQuota;

pub trait QuotaSource: Send + Sync {
    /// Whether a session push carries the provider's whole window set, so it
    /// replaces the stored windows instead of sparse-merging onto them. A window
    /// the provider stopped reporting then disappears instead of lingering.
    fn push_is_snapshot(&self) -> bool {
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
