//! Re-probing one adapter on demand, past the registry's "refresh once per
//! daemon lifetime" gate — used after its CLI was updated in place.

use crate::{AdapterError, AdapterRegistry};

impl AdapterRegistry {
    /// Forget the adapter's successful refresh and cached catalog, then run a
    /// fresh refresh: a new `--version` probe, a capability recompute, and a
    /// live catalog request whose result reaches clients as
    /// `adapter.models.updated`. A no-op until refresh is allowed at boot.
    pub async fn force_refresh(&self, adapter_id: &str) -> Result<(), AdapterError> {
        let Some(adapter) = self.get(adapter_id) else {
            return Ok(());
        };
        adapter.invalidate_catalog();
        self.succeeded.remove(adapter_id);
        self.refresh_adapter(adapter_id).await
    }
}
