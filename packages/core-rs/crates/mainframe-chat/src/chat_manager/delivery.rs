//! How a plain-text send reaches its adapter: a new turn (carrying any
//! pending provider-switch handoff) or a steer into the running one.

/// How a plain-text send reaches the adapter.
pub(super) enum Delivery<'a> {
    /// A new turn (or a CLI-queued one). `handoff` is the pending provider
    /// switch context, prepended for the provider only.
    Turn { handoff: Option<&'a str> },
    /// Folded into the running turn. A turn is already under way, so no
    /// handoff can be pending for it.
    Steer,
}
