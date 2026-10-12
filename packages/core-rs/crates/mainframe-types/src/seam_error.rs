//! The error a dependency seam (a `*Deps` trait, a port, an injected closure)
//! returns when the concrete failure lives in a crate the trait's owner does
//! not depend on: the daemon's SQLite store, the OS keyring, an HTTP client.
//! The original error rides along as the source, so callers keep its text and
//! its chain instead of a flattened `String`.

use std::sync::Arc;

/// An opaque failure from behind a dependency seam. `Display` is the wrapped
/// error's own text, byte for byte. Cheap to clone, and two seam errors are
/// equal when their texts are, so the domain enums that carry one keep their
/// `Clone`/`PartialEq` derives.
#[derive(Debug, Clone, thiserror::Error)]
#[error(transparent)]
pub struct SeamError(Arc<dyn std::error::Error + Send + Sync + 'static>);

impl SeamError {
    pub fn new(error: impl std::error::Error + Send + Sync + 'static) -> Self {
        Self(Arc::new(error))
    }

    /// A seam failure with no richer source than its message (a test double,
    /// a guard a default trait method trips).
    pub fn msg(message: impl Into<String>) -> Self {
        let boxed: Box<dyn std::error::Error + Send + Sync> = message.into().into();
        Self(Arc::from(boxed))
    }

    /// The wrapped error, for a caller that needs to branch on its type.
    pub fn downcast_ref<E: std::error::Error + 'static>(&self) -> Option<&E> {
        self.0.downcast_ref::<E>()
    }
}

impl PartialEq for SeamError {
    fn eq(&self, other: &Self) -> bool {
        self.to_string() == other.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_wrapped_text_and_type() {
        let err = SeamError::new(std::io::Error::other("disk full"));
        assert_eq!(err.to_string(), "disk full");
        assert!(err.downcast_ref::<std::io::Error>().is_some());
        assert_eq!(SeamError::msg("no store").to_string(), "no store");
    }
}
