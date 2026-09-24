//! Rule 7 (todo #346) — the no-persistence spawn decision and the
//! context-loss transition it feeds into `lifecycle_manager`'s `do_load_chat`
//! and `do_start_chat`.

/// Per-spawn decision: a chat only ever spawns with no vendor persistence when
/// it is itself temporary AND the adapter reports the capability. Never
/// derived from the adapter id (AC 2) — callers pass in the registry's
/// reported `capabilities().no_persistence`.
pub fn should_start_without_persistence(
    temporary: bool,
    adapter_supports_no_persistence: bool,
) -> bool {
    temporary && adapter_supports_no_persistence
}

/// True when the chat's last stored provider session was started with no
/// persistence and still carries a (now-dead) resume id. Checked before the
/// resume target is read in both `do_load_chat` and `do_start_chat` — by the
/// time either reaches this check no live process holds the session (both
/// early-return on an already-spawned session first), so a persisted
/// `vendor_session_ephemeral` flag here always means the CLI never wrote a
/// resumable transcript for `claude_session_id`.
pub fn context_was_lost(vendor_session_ephemeral: bool, claude_session_id: Option<&str>) -> bool {
    vendor_session_ephemeral && claude_session_id.is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_persistence_only_when_both_temporary_and_capable() {
        assert!(should_start_without_persistence(true, true));
        assert!(!should_start_without_persistence(true, false));
        assert!(!should_start_without_persistence(false, true));
        assert!(!should_start_without_persistence(false, false));
    }

    #[test]
    fn context_lost_requires_both_the_ephemeral_flag_and_a_stored_session_id() {
        assert!(context_was_lost(true, Some("sess-1")));
        assert!(!context_was_lost(true, None));
        assert!(!context_was_lost(false, Some("sess-1")));
        assert!(!context_was_lost(false, None));
    }
}

// PORT STATUS: NEW module (todo #346, G2b)
// confidence: high
// todos: 0
// notes: both functions are pure booleans; the DB write + in-memory sync +
// notes: broadcast that "marking" the loss performs live in
// notes: `lifecycle_manager::ChatLifecycleManager::mark_context_lost_if_needed`,
// notes: which needs the deps seam and the active-chat cell this module does
// notes: not have access to.
