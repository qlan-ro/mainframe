use super::*;

/// Flight families share an outer lock for cross-operation exclusion.
#[derive(Default)]
pub(super) struct Guards {
    pub(super) loading: SingleFlight,
    pub(super) restoring: SingleFlight,
    pub(super) starting: SingleFlight,
    pub(super) interrupting: SingleFlight,
    /// In-flight idle offload per chat (`flight_claims.rs`). An offload claims
    /// this slot only when every other map below is empty for the chat and no
    /// send is registered;
    /// `load_chat`/`start_chat`/`get_messages`/`send_message` all wait it out
    /// before touching the registry or cache.
    pub(super) maintenance: SingleFlight,
    pub(super) offloading: SingleFlight,
    /// In-flight `send_message` calls per chat (`flight_claims.rs`).
    /// A count, not a flag: nothing in this codebase serializes concurrent
    /// sends to the same chat today, so offload must treat any of them as busy.
    pub(super) sending: HashMap<String, usize>,
    /// In-flight on-disk transcript read behind `get_messages` per chat
    /// (`flight_claims.rs`) — single-flights a read that would otherwise race
    /// (two concurrent misses both hit disk).
    pub(super) history: SingleFlight,
}
