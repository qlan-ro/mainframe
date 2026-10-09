//! The same-adapter respawn path (`PATCH /config` model changes that cross
//! endpoints) shares two rules with a provider switch: a no-op model change
//! never respawns, and a respawn never kills live background work.

use crate::segments::switch_rules::{SwitchError, is_default_model};

/// Whether moving from `current` to `requested` changes the model. `None` and
/// `"default"` name the same model.
pub fn model_changed(current: Option<&str>, requested: Option<&str>) -> bool {
    match requested {
        Some(m) => current != Some(m) && !(is_default_model(Some(m)) && is_default_model(current)),
        None => false,
    }
}

/// The refusal when a respawn would end live background tasks.
pub fn respawn_refusal(
    session_spawned: bool,
    live_tasks: usize,
    adapter_name: &str,
) -> Option<String> {
    (session_spawned && live_tasks > 0)
        .then(|| SwitchError::BackgroundWork(adapter_name.to_string()).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_aliases_are_not_a_model_change() {
        assert!(!model_changed(None, Some("default")));
        assert!(!model_changed(Some("default"), Some("default")));
        assert!(!model_changed(Some("m1"), None));
        assert!(model_changed(Some("m1"), Some("m2")));
        assert!(model_changed(None, Some("m2")));
        assert!(model_changed(Some("m1"), Some("default")));
    }

    #[test]
    fn a_spawned_session_with_live_tasks_refuses_the_respawn() {
        assert_eq!(respawn_refusal(false, 3, "Claude"), None);
        assert_eq!(respawn_refusal(true, 0, "Claude"), None);
        let refusal = respawn_refusal(true, 1, "Claude").unwrap();
        assert!(refusal.starts_with("Claude is still running background agents or commands"));
    }
}
