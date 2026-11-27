//! What a paged first window showed, so the full load that follows can tell
//! whether the client already holds the same transcript tail.
use std::hash::{Hash, Hasher};

use mainframe_types::display::DisplayMessage;

/// One window message: its id and a hash of everything the client renders.
pub(crate) type Mark = (String, u64);

pub(crate) fn fingerprint(messages: &[DisplayMessage]) -> Vec<Mark> {
    messages
        .iter()
        .map(|message| {
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            serde_json::to_string(message)
                .unwrap_or_default()
                .hash(&mut hasher);
            (message.id.clone(), hasher.finish())
        })
        .collect()
}

/// Whether `full` ends with exactly the messages the window showed.
pub(crate) fn matches_tail(window: &[Mark], full: &[DisplayMessage]) -> bool {
    !window.is_empty()
        && full.len() >= window.len()
        && fingerprint(&full[full.len() - window.len()..]) == window
}
